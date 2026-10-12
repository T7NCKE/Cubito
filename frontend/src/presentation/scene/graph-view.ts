import * as THREE from 'three'
import { childrenOf } from '../../domain/worktree-graph/graph-traversal'
import type { WorktreeGraph, WorktreeId } from '../../domain/worktree-graph/types'
import { DEFAULT_CAMERA_HEIGHT } from '../camera/camera-pose'
import type { CameraHeight } from '../camera/camera-pose'
import type { Vec3 } from '../camera/camera-framing'
import {
  CUBE_OBSTACLE_MARGIN_PX,
  LABEL_OFFSET_Y_PX,
  labelBoxPx,
  labelDropPx,
  labelRectAt,
  projectedCubeRect,
  resolveLabelCollisions
} from '../hud/label-collision-model'
import type {
  LabelAnchorProjection,
  LabelBox,
  LabelCandidate,
  LabelObstacle,
  LabelRect,
  ScreenAnchor
} from '../hud/label-collision-model'
import { labelPriorityAt, labelRenderOrder, labelVisibleAt } from '../hud/label-visibility-model'
import { createNodeLabel } from '../hud/node-label-element'
import type { NodeLabelHandle } from '../hud/node-label-element'
import { nodeLabelModel } from '../hud/node-label-model'
import { galaxyLayout } from '../layout/galaxy-layout'
import { edgeVisual } from '../theme/edge-visual'
import { elevationFor } from '../theme/node-elevation'
import { deriveDecorations, deriveNodeState } from '../theme/node-state'
import type { NodeState } from '../theme/node-state'
import { nodeVisual } from '../theme/node-visual'
import type { ScenePalette } from '../theme/scene-palette'
import { NODE_HALF_HEIGHT, NODE_SIZE } from '../theme/scene-metrics'
import { createEdgeBinding } from './edge-line'
import type { EdgeBinding } from './edge-line'
import { createNodeBinding } from './node-mesh'
import type { NodeBinding } from './node-mesh'
import { createSceneResources } from './scene-resources'

export type GraphViewInput = {
  graph: WorktreeGraph
  selectedId: WorktreeId | null
  palette: ScenePalette
  /** repoId of the active island — undimmed. Optional: main.ts is the only caller that knows it. */
  activeRepoId?: string | null
  /** Drives per-node label visibility (design D12). Defaults to DEFAULT_CAMERA_HEIGHT. */
  cameraHeight?: CameraHeight
  /** Whose children get labels in `comparar` (design §1.4): the camada parent, which may not
   *  be main. Null/absent falls back to every `isMain` node — today's behavior. */
  labelAnchorId?: WorktreeId | null
}

/** Injectable so the reconciliation suite runs under `environment:'node'`, where the real
 *  `CSS2DObject` label writer has no `document`. */
export type GraphViewOptions = {
  createLabel?: () => NodeLabelHandle
}

export type GraphView = {
  group: THREE.Group
  update(input: GraphViewInput): void
  tick(elapsedSeconds: number): void
  setResolution(width: number, height: number): void
  nodeCenter(id: WorktreeId): Vec3 | null
  nodeCenters(): Vec3[]
  /** Node groups eligible for raycast picking (node-pick.ts). */
  pickableObjects(): readonly THREE.Object3D[]
  /** Per-frame screen-space pass (design D3). Only ever HIDES; the height policy decides what is eligible. */
  resolveLabelOverlaps(project: LabelAnchorProjection): void
  /** Projected screen rect of one node's cube (glow margin included); null when unknown/off-camera. */
  nodeCubeRect(id: WorktreeId, project: LabelAnchorProjection): LabelRect | null
  dispose(): void
}

type NodeEntry = {
  binding: NodeBinding
  label: NodeLabelHandle
  priority: number
  box: LabelBox
  policyVisible: boolean
}

const edgeKey = (from: WorktreeId, to: WorktreeId): string => `${from}->${to}`

/**
 * Keyed reconciliation between the domain graph and its THREE bindings (design §5.6):
 * bindings are reused by node id / `from->to` edge key across updates, absent keys are
 * swept and disposed, and nothing is ever rebuilt wholesale — `group.clear()` would
 * detach without disposing, which is the leak this replaces. All visual decisions come
 * from the pure theme pipeline; this file only binds their output to objects.
 */
export function createGraphView(
  scene: THREE.Object3D,
  labelLayer: THREE.Object3D,
  options?: GraphViewOptions
): GraphView {
  const group = new THREE.Group()
  scene.add(group)

  const resources = createSceneResources()
  const makeLabel = options?.createLabel ?? createNodeLabel
  const nodes = new Map<WorktreeId, NodeEntry>()
  const edges = new Map<string, EdgeBinding>()
  const centers = new Map<WorktreeId, Vec3>()
  const states = new Map<WorktreeId, NodeState>()
  const hiddenByCollision = new Set<WorktreeId>()
  let resolution: { width: number; height: number } | null = null

  const dropNode = (id: WorktreeId, entry: NodeEntry): void => {
    group.remove(entry.binding.object)
    labelLayer.remove(entry.label.object)
    entry.binding.dispose()
    entry.label.dispose()
    nodes.delete(id)
    centers.delete(id)
    states.delete(id)
    hiddenByCollision.delete(id)
  }

  const dropEdge = (key: string, binding: EdgeBinding): void => {
    group.remove(binding.object)
    binding.dispose()
    edges.delete(key)
  }

  const syncNodes = ({
    graph,
    selectedId,
    palette,
    activeRepoId = null,
    cameraHeight = DEFAULT_CAMERA_HEIGHT,
    labelAnchorId = null
  }: GraphViewInput): void => {
    const positions = galaxyLayout(graph)
    const anchorIds =
      labelAnchorId != null
        ? [labelAnchorId]
        : [...graph.nodes.values()].filter((n) => n.isMain).map((n) => n.id)
    const childrenOfAnchor = new Set<WorktreeId>(anchorIds.flatMap((id) => childrenOf(graph, id)))

    for (const node of graph.nodes.values()) {
      const ground = positions.get(node.id)
      if (!ground) continue

      const state = deriveNodeState(node)
      const decorations = deriveDecorations(node, node.id === selectedId, activeRepoId)
      const elevation = elevationFor(state, node.kind)
      const role = {
        isMain: node.isMain,
        isSelected: node.id === selectedId,
        isChildOfAnchor: childrenOfAnchor.has(node.id),
        state
      }
      const visible = labelVisibleAt(cameraHeight, role)
      const label = nodeLabelModel(node, state, decorations, visible)
      const priority = labelPriorityAt(role)
      const box = labelBoxPx(label)

      let entry = nodes.get(node.id)
      if (!entry) {
        const binding = createNodeBinding(resources)
        binding.object.userData.worktreeId = node.id
        group.add(binding.object)
        const labelHandle = makeLabel()
        labelLayer.add(labelHandle.object)
        entry = { binding, label: labelHandle, priority, box, policyVisible: visible }
        nodes.set(node.id, entry)
      }
      entry.priority = priority
      entry.box = box
      entry.policyVisible = visible

      entry.binding.apply({
        visual: nodeVisual(node.kind, state, decorations, palette),
        elevation,
        ground,
        label,
        shadowColor: palette.shadow
      })
      // Masked with the LAST frame's collision result — a store-driven update() must never
      // resurrect a label the per-frame pass just hid (design D3 data flow).
      entry.label.apply({ ...label, visible: label.visible && !hiddenByCollision.has(node.id) })
      entry.label.object.position.set(ground.x, 0, ground.z)
      entry.label.object.renderOrder = labelRenderOrder(priority)

      states.set(node.id, state)
      centers.set(node.id, { x: ground.x, y: elevation.height + NODE_HALF_HEIGHT, z: ground.z })
    }

    for (const [id, entry] of [...nodes]) {
      if (!graph.nodes.has(id)) dropNode(id, entry)
    }
  }

  const syncEdges = ({ graph, palette }: GraphViewInput): void => {
    const live = new Set<string>()

    for (const edge of graph.edges) {
      const from = centers.get(edge.from)
      const to = centers.get(edge.to)
      const fromState = states.get(edge.from)
      const toState = states.get(edge.to)
      if (!from || !to || !fromState || !toState) continue

      const key = edgeKey(edge.from, edge.to)
      live.add(key)
      let binding = edges.get(key)
      if (!binding) {
        binding = createEdgeBinding()
        binding.object.userData.edgeKey = key
        if (resolution) binding.setResolution(resolution.width, resolution.height)
        group.add(binding.object)
        edges.set(key, binding)
      }
      binding.apply({ visual: edgeVisual(fromState, toState, palette), from, to })
    }

    for (const [key, binding] of [...edges]) {
      if (!live.has(key)) dropEdge(key, binding)
    }
  }

  /** Perspective-scaled drop from the projected height of one world-up unit at the anchor. */
  const dropFor = (project: LabelAnchorProjection, ground: Vec3, anchor: ScreenAnchor): number => {
    if (!resolution) return LABEL_OFFSET_Y_PX
    const raised = project({ x: ground.x, y: ground.y + 1, z: ground.z })
    return labelDropPx(Math.abs(raised.y - anchor.y), resolution.height)
  }

  /** Screen rect of a node's cube (8 projected corners + glow margin); null when off-camera. */
  const cubeObstacle = (id: WorktreeId, project: LabelAnchorProjection): LabelObstacle | null => {
    const center = centers.get(id)
    if (!center) return null
    const half = NODE_SIZE / 2
    const corners: ScreenAnchor[] = []
    for (const dx of [-half, half]) {
      for (const dy of [-NODE_HALF_HEIGHT, NODE_HALF_HEIGHT]) {
        for (const dz of [-half, half]) {
          corners.push(project({ x: center.x + dx, y: center.y + dy, z: center.z + dz }))
        }
      }
    }
    const rect = projectedCubeRect(corners, CUBE_OBSTACLE_MARGIN_PX)
    return rect === null ? null : { id, rect }
  }

  const resolveLabelOverlaps = (project: LabelAnchorProjection): void => {
    const candidates: LabelCandidate[] = []
    const obstacles: LabelObstacle[] = []
    for (const [id, entry] of nodes) {
      const cube = cubeObstacle(id, project)
      if (cube) obstacles.push(cube)
      if (!entry.policyVisible) continue
      const position = entry.label.object.position
      const anchor = project(position)
      if (!anchor.visible) continue
      const dropPx = dropFor(project, position, anchor)
      entry.label.setDropPx(dropPx)
      candidates.push({
        id,
        rect: labelRectAt(anchor, entry.box, dropPx),
        priority: entry.priority
      })
    }
    const nextHidden =
      candidates.length < 2 && obstacles.length === 0
        ? new Set<WorktreeId>()
        : resolveLabelCollisions(candidates, hiddenByCollision, obstacles)
    hiddenByCollision.clear()
    for (const id of nextHidden) hiddenByCollision.add(id)
    for (const [id, entry] of nodes) {
      entry.label.object.visible = entry.policyVisible && !hiddenByCollision.has(id)
    }
  }

  return {
    group,
    update(input: GraphViewInput): void {
      syncNodes(input)
      syncEdges(input)
    },
    resolveLabelOverlaps,
    nodeCubeRect: (id, project) => cubeObstacle(id, project)?.rect ?? null,
    tick(elapsedSeconds: number): void {
      for (const entry of nodes.values()) entry.binding.tick(elapsedSeconds)
      for (const binding of edges.values()) binding.tick(elapsedSeconds)
    },
    setResolution(width: number, height: number): void {
      resolution = { width, height }
      for (const binding of edges.values()) binding.setResolution(width, height)
    },
    nodeCenter(id: WorktreeId): Vec3 | null {
      return centers.get(id) ?? null
    },
    nodeCenters(): Vec3[] {
      return [...centers.values()]
    },
    pickableObjects(): readonly THREE.Object3D[] {
      return [...nodes.values()].map((entry) => entry.binding.object)
    },
    dispose(): void {
      for (const [id, entry] of [...nodes]) dropNode(id, entry)
      for (const [key, binding] of [...edges]) dropEdge(key, binding)
      resources.dispose()
      scene.remove(group)
    }
  }
}
