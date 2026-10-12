import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { buildWorktreeGraph } from '../../domain/worktree-graph/build-graph'
import type { RawWorktreeRecord } from '../../domain/worktree-graph/build-graph'
import type { WorktreeGraph, WorktreeId } from '../../domain/worktree-graph/types'
import type { CameraHeight } from '../camera/camera-pose'
import { LABEL_DROP_MAX_FACTOR, labelBoxPx } from '../hud/label-collision-model'
import type { LabelAnchorProjection } from '../hud/label-collision-model'
import type { NodeLabelModel } from '../hud/node-label-model'
import type { NodeLabelHandle } from '../hud/node-label-element'
import { projectToScreen } from '../hud/terminal-connector-projector'
import { darkPalette } from '../theme/scene-palette'
import { NODE_HALF_HEIGHT } from '../theme/scene-metrics'
import { createGraphView } from './graph-view'
import type { GraphView } from './graph-view'

type ActivityOverrides = Pick<RawWorktreeRecord, 'agentStatus' | 'isUnread' | 'isArchived'>

const record = (
  id: string,
  parent: string | null,
  children: readonly string[],
  extra: Partial<ActivityOverrides> = {}
): RawWorktreeRecord => {
  const raw: RawWorktreeRecord = {
    id,
    // Fixed, shared repoId: these ids ('root', 'a', ...) have no '::' separator, so the
    // domain fallback (id.split('::')[0]) would otherwise give every node its own island.
    repoId: 'repo',
    branch: `refs/heads/${id}`,
    parentWorktreeId: parent,
    childWorktreeIds: [...children],
    workspaceStatus: 'in-progress',
    git: { path: `/${id}`, isMainWorktree: parent === null }
  }
  if (extra.agentStatus !== undefined) raw.agentStatus = extra.agentStatus
  if (extra.isUnread !== undefined) raw.isUnread = extra.isUnread
  if (extra.isArchived !== undefined) raw.isArchived = extra.isArchived
  return raw
}

const graphOf = (...records: readonly RawWorktreeRecord[]): WorktreeGraph =>
  buildWorktreeGraph(records)

/** root → (a, b) */
const baseGraph = (): WorktreeGraph =>
  graphOf(record('root', null, ['a', 'b']), record('a', 'root', []), record('b', 'root', []))

const fakeLabel = (): NodeLabelHandle => ({
  object: new THREE.Object3D() as unknown as NodeLabelHandle['object'],
  apply: vi.fn(),
  setDropPx: vi.fn(),
  dispose: vi.fn()
})

type Harness = {
  view: GraphView
  scene: THREE.Object3D
  labelLayer: THREE.Object3D
  labels: NodeLabelHandle[]
  update(
    graph: WorktreeGraph,
    selectedId?: WorktreeId | null,
    activeRepoId?: string | null,
    cameraHeight?: CameraHeight,
    labelAnchorId?: WorktreeId | null
  ): void
}

const harness = (): Harness => {
  const scene = new THREE.Object3D()
  const labelLayer = new THREE.Object3D()
  const labels: NodeLabelHandle[] = []
  const view = createGraphView(scene, labelLayer, {
    createLabel: () => {
      const label = fakeLabel()
      labels.push(label)
      return label
    }
  })
  return {
    view,
    scene,
    labelLayer,
    labels,
    update(graph, selectedId = null, activeRepoId = null, cameraHeight, labelAnchorId) {
      view.update({
        graph,
        selectedId,
        palette: darkPalette,
        activeRepoId,
        ...(cameraHeight !== undefined ? { cameraHeight } : {}),
        ...(labelAnchorId !== undefined ? { labelAnchorId } : {})
      })
    }
  }
}

/** Labels are pushed in `graph.nodes.values()` order on first creation — same assumption the
 *  existing "disposes the removed node label" test above relies on. */
const lastLabelModel = (labels: NodeLabelHandle[], index: number): NodeLabelModel => {
  const label = labels[index]
  if (!label) throw new Error(`no label at index ${index}`)
  const lastCall = (label.apply as ReturnType<typeof vi.fn>).mock.calls.at(-1)
  if (!lastCall) throw new Error(`label ${index} was never applied`)
  return lastCall[0]
}

const nodeObject = (view: GraphView, id: WorktreeId): THREE.Object3D | undefined =>
  view.group.children.find((child) => child.userData.worktreeId === id)

const edgeObject = (view: GraphView, key: string): THREE.Object3D | undefined =>
  view.group.children.find((child) => child.userData.edgeKey === key)

const materialsUnder = (object: THREE.Object3D): THREE.Material[] => {
  const found = new Set<THREE.Material>()
  object.traverse((child) => {
    const material = (child as Partial<THREE.Mesh>).material
    if (!material) return
    for (const one of Array.isArray(material) ? material : [material]) found.add(one)
  })
  return [...found]
}

const ringOf = (object: THREE.Object3D): THREE.Object3D | undefined =>
  object.getObjectByName('ring')

const surfaceMaterialsOf = (view: GraphView, id: WorktreeId): THREE.MeshBasicMaterial[] => {
  const object = nodeObject(view, id)
  if (!object) throw new Error(`missing node ${id}`)
  return (object.getObjectByName('surface') as THREE.Mesh).material as THREE.MeshBasicMaterial[]
}

const ringedNodeIds = (view: GraphView, graph: WorktreeGraph): WorktreeId[] =>
  [...graph.nodes.keys()].filter((id) => {
    const object = nodeObject(view, id)
    return object !== undefined && ringOf(object)?.visible === true
  })

/** Huge FOV (long lens' opposite — tan(halfFov) blows up) + large distance: every node's
 *  ground point collapses to nearly the same screen point, so any two eligible labels are
 *  guaranteed to overlap regardless of the real layout distances — a real THREE camera + the
 *  pure projector, no DOM. */
const collapsingProjection = (): LabelAnchorProjection => {
  const camera = new THREE.PerspectiveCamera(178, 1, 1, 5000)
  camera.position.set(0, 0, 200)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  return (ground) => {
    const vector = new THREE.Vector3(ground.x, ground.y, ground.z)
    vector.project(camera)
    return projectToScreen(vector, 800, 600)
  }
}

/** Maps `fromWorldZ` to screen x=0 and `toWorldZ` to screen x=screenGapPx (galaxyLayout fans
 *  siblings apart in z, not x — see the layout debug), so a test can dial in an exact pixel
 *  overlap between two real, layout-derived ground positions. */
const affineProjectionBetween = (
  fromWorldZ: number,
  toWorldZ: number,
  screenGapPx: number
): LabelAnchorProjection => {
  const scale = screenGapPx / (toWorldZ - fromWorldZ)
  return (ground) => ({ x: (ground.z - fromWorldZ) * scale, y: 0, visible: true })
}

describe('createGraphView', () => {
  it('adds its group to the scene and one object per node and edge', () => {
    const h = harness()
    h.update(baseGraph())

    expect(h.scene.children).toContain(h.view.group)
    expect(nodeObject(h.view, 'root')).toBeDefined()
    expect(nodeObject(h.view, 'a')).toBeDefined()
    expect(edgeObject(h.view, 'root->a')).toBeDefined()
    expect(edgeObject(h.view, 'root->b')).toBeDefined()
  })

  it('reuses the same binding object for an unchanged node across an add + remove update', () => {
    const h = harness()
    h.update(baseGraph())
    const rootBefore = nodeObject(h.view, 'root')
    const aBefore = nodeObject(h.view, 'a')
    const edgeBefore = edgeObject(h.view, 'root->a')

    // 'b' removed, 'c' added — 'a' and 'root' are untouched.
    h.update(
      graphOf(record('root', null, ['a', 'c']), record('a', 'root', []), record('c', 'root', []))
    )

    expect(nodeObject(h.view, 'root')).toBe(rootBefore)
    expect(nodeObject(h.view, 'a')).toBe(aBefore)
    expect(edgeObject(h.view, 'root->a')).toBe(edgeBefore)
    expect(nodeObject(h.view, 'b')).toBeUndefined()
    expect(nodeObject(h.view, 'c')).toBeDefined()
  })

  it('keeps decoration child identity when only the surface colour changes', () => {
    const h = harness()
    h.update(baseGraph())
    const a = nodeObject(h.view, 'a')
    const ringBefore = a && ringOf(a)

    h.update(
      graphOf(
        record('root', null, ['a', 'b']),
        record('a', 'root', [], { agentStatus: 'working' }),
        record('b', 'root', [])
      )
    )

    expect(nodeObject(h.view, 'a')).toBe(a)
    expect(a && ringOf(a)).toBe(ringBefore)
  })

  it('disposes every material of a removed node (via the material dispose event)', () => {
    const h = harness()
    h.update(baseGraph())
    const b = nodeObject(h.view, 'b')
    expect(b).toBeDefined()
    const spy = vi.fn()
    for (const material of materialsUnder(b as THREE.Object3D)) {
      material.addEventListener('dispose', spy)
    }

    h.update(graphOf(record('root', null, ['a']), record('a', 'root', [])))

    expect(spy).toHaveBeenCalled()
    expect(h.view.group.children).not.toContain(b)
  })

  it('disposes a removed edge binding and drops it from the group', () => {
    const h = harness()
    h.update(baseGraph())
    const edge = edgeObject(h.view, 'root->b')
    expect(edge).toBeDefined()
    const spy = vi.fn()
    for (const material of materialsUnder(edge as THREE.Object3D)) {
      material.addEventListener('dispose', spy)
    }

    h.update(graphOf(record('root', null, ['a']), record('a', 'root', [])))

    expect(spy).toHaveBeenCalled()
    expect(edgeObject(h.view, 'root->b')).toBeUndefined()
  })

  it('disposes the removed node label and never touches surviving ones', () => {
    const h = harness()
    h.update(baseGraph())
    expect(h.labels).toHaveLength(3)
    const [rootLabel, , bLabel] = h.labels as [NodeLabelHandle, NodeLabelHandle, NodeLabelHandle]

    h.update(graphOf(record('root', null, ['a']), record('a', 'root', [])))

    expect(bLabel.dispose).toHaveBeenCalledTimes(1)
    expect(rootLabel.dispose).not.toHaveBeenCalled()
    expect(h.labelLayer.children).not.toContain(bLabel.object)
    expect(h.labelLayer.children).toContain(rootLabel.object)
  })

  it('never disposes the shared cube geometry when a node churns', () => {
    const h = harness()
    h.update(baseGraph())
    const surface = nodeObject(h.view, 'b')?.getObjectByName('surface') as THREE.Mesh | undefined
    expect(surface).toBeDefined()
    const spy = vi.fn()
    ;(surface as THREE.Mesh).geometry.addEventListener('dispose', spy)

    h.update(graphOf(record('root', null, ['a']), record('a', 'root', [])))
    h.update(baseGraph())

    expect(spy).not.toHaveBeenCalled()
  })

  it('keeps exactly one selection ring across selection changes', () => {
    const h = harness()
    const graph = baseGraph()

    h.update(graph, 'a')
    expect(ringedNodeIds(h.view, graph)).toEqual(['a'])

    h.update(graph, 'b')
    expect(ringedNodeIds(h.view, graph)).toEqual(['b'])

    h.update(graph, null)
    expect(ringedNodeIds(h.view, graph)).toEqual([])
  })

  it('reports node centres lifted by the elevation ladder, never on the ground plane', () => {
    const h = harness()
    const graph = baseGraph()
    h.update(graph)

    const rootCenter = h.view.nodeCenter('root')
    expect(rootCenter).not.toBeNull()
    expect(rootCenter?.y).toBeGreaterThan(NODE_HALF_HEIGHT)
    expect(h.view.nodeCenter('missing')).toBeNull()
    expect(h.view.nodeCenters()).toHaveLength(graph.nodes.size)
  })

  it('forwards setResolution to every edge material', () => {
    const h = harness()
    h.update(baseGraph())
    h.view.setResolution(800, 600)

    const edge = edgeObject(h.view, 'root->a') as THREE.Line
    const material = edge.material as THREE.Material & { resolution: THREE.Vector2 }
    expect(material.resolution.x).toBe(800)
    expect(material.resolution.y).toBe(600)
  })

  it('ticks edge flow from the global clock', () => {
    const h = harness()
    h.update(
      graphOf(record('root', null, ['a']), record('a', 'root', [], { agentStatus: 'working' }))
    )
    const edge = edgeObject(h.view, 'root->a') as THREE.Line
    const material = edge.material as THREE.Material & { dashOffset: number }

    h.view.tick(0)
    const atZero = material.dashOffset
    h.view.tick(0.3)

    expect(material.dashOffset).not.toBe(atZero)
  })

  it('dims nodes outside the active repo and leaves the active repo at full opacity', () => {
    const h = harness()
    const repoA = { ...record('a::root', null, []), repoId: 'a' }
    const repoB = { ...record('b::root', null, []), repoId: 'b' }
    const graph = buildWorktreeGraph([repoA, repoB])

    h.update(graph, null, 'a')

    for (const material of surfaceMaterialsOf(h.view, 'a::root')) expect(material.opacity).toBe(1)
    for (const material of surfaceMaterialsOf(h.view, 'b::root'))
      expect(material.opacity).toBeLessThan(1)
  })

  it('undims every node when activeRepoId is null (single-repo / not loaded)', () => {
    const h = harness()
    h.update(baseGraph(), null, null)

    for (const material of surfaceMaterialsOf(h.view, 'root')) expect(material.opacity).toBe(1)
    for (const material of surfaceMaterialsOf(h.view, 'a')) expect(material.opacity).toBe(1)
  })

  it("the label model's visible flag follows the active camera height", () => {
    const h = harness()
    const graph = baseGraph() // root is main, isla shows main; foco shows only the selected

    h.update(graph, 'a', null, 'isla')
    expect(lastLabelModel(h.labels, 0).visible).toBe(true) // root — isMain
    expect(lastLabelModel(h.labels, 1).visible).toBe(false) // a — merely selected

    h.update(graph, 'a', null, 'foco')
    expect(lastLabelModel(h.labels, 0).visible).toBe(false) // root — main, but not selected
    expect(lastLabelModel(h.labels, 1).visible).toBe(true) // a — selected
  })

  it("an absent labelAnchorId falls back to every main node's children (today's behavior)", () => {
    const h = harness()
    const graph = baseGraph() // root -> (a, b), root is main

    h.update(graph, null, null, 'comparar')

    expect(lastLabelModel(h.labels, 0).visible).toBe(false) // root — main itself, not a child
    expect(lastLabelModel(h.labels, 1).visible).toBe(true) // a — child of main
    expect(lastLabelModel(h.labels, 2).visible).toBe(true) // b — child of main
  })

  it("labelAnchorId scopes the comparar labels to that node's children, not main's", () => {
    const h = harness()
    // root -> (a, b); a -> (c, d) — the camada is on `a`, a non-root, non-main node.
    const graph = graphOf(
      record('root', null, ['a', 'b']),
      record('a', 'root', ['c', 'd']),
      record('b', 'root', []),
      record('c', 'a', []),
      record('d', 'a', [])
    )

    h.update(graph, null, null, 'comparar', 'a')

    expect(lastLabelModel(h.labels, 0).visible).toBe(false) // root — not a's child
    expect(lastLabelModel(h.labels, 1).visible).toBe(false) // a — the anchor itself
    expect(lastLabelModel(h.labels, 2).visible).toBe(false) // b — a's sibling, not its child
    expect(lastLabelModel(h.labels, 3).visible).toBe(true) // c — child of the anchor
    expect(lastLabelModel(h.labels, 4).visible).toBe(true) // d — child of the anchor
  })

  it('a camada parent that is not main still gets its own children labelled', () => {
    const h = harness()
    const graph = graphOf(
      record('root', null, ['p']),
      record('p', 'root', ['c1', 'c2']),
      record('c1', 'p', []),
      record('c2', 'p', [])
    )

    h.update(graph, null, null, 'comparar', 'p')

    expect(lastLabelModel(h.labels, 2).visible).toBe(true) // c1
    expect(lastLabelModel(h.labels, 3).visible).toBe(true) // c2
  })

  it('an unknown labelAnchorId labels nothing in comparar', () => {
    const h = harness()
    const graph = baseGraph() // root -> (a, b)

    h.update(graph, null, null, 'comparar', 'does-not-exist')

    expect(lastLabelModel(h.labels, 0).visible).toBe(false)
    expect(lastLabelModel(h.labels, 1).visible).toBe(false)
    expect(lastLabelModel(h.labels, 2).visible).toBe(false)
  })

  it("a selected node's label renderOrder exceeds an idle sibling's, and both stay negative", () => {
    const h = harness()
    const graph = baseGraph() // root -> (a, b); root is main

    h.update(graph, 'a', null, 'isla')

    const [rootLabel, aLabel] = h.labels as [NodeLabelHandle, NodeLabelHandle]
    expect(aLabel.object.renderOrder).toBeGreaterThan(rootLabel.object.renderOrder)
    expect(aLabel.object.renderOrder).toBeLessThan(0)
    expect(rootLabel.object.renderOrder).toBeLessThan(0)
  })

  it('an absent cameraHeight defaults to isla', () => {
    const h = harness()
    const graph = baseGraph()

    h.update(graph, null, null)

    expect(lastLabelModel(h.labels, 0).visible).toBe(true) // root — isMain, isla shows it
  })

  it('pickableObjects returns exactly the node groups', () => {
    const h = harness()
    const graph = baseGraph()
    h.update(graph)

    const rootObject = nodeObject(h.view, 'root')
    const aObject = nodeObject(h.view, 'a')
    const bObject = nodeObject(h.view, 'b')

    expect(new Set(h.view.pickableObjects())).toEqual(new Set([rootObject, aObject, bObject]))
  })

  it('disposes every binding and label on dispose and detaches from the scene', () => {
    const h = harness()
    h.update(baseGraph())
    const spy = vi.fn()
    for (const child of h.view.group.children) {
      for (const material of materialsUnder(child)) material.addEventListener('dispose', spy)
    }

    h.view.dispose()

    expect(spy).toHaveBeenCalled()
    expect(h.scene.children).not.toContain(h.view.group)
    for (const label of h.labels) expect(label.dispose).toHaveBeenCalled()
  })
})

/** Screen-space stub: anchor y = `anchorY(x)`, and one world-up unit spans `pxPerUnit(x)` px. */
const scaledProjection = (
  anchorY: (x: number) => number,
  pxPerUnit: (x: number) => number
): LabelAnchorProjection => {
  return (ground) => ({
    x: 400,
    y: anchorY(ground.x) - ground.y * pxPerUnit(ground.x),
    visible: true
  })
}

describe('resolveLabelOverlaps drop scaling', () => {
  const twoWorkingNodes = (h: Harness): void => {
    h.view.setResolution(800, 900)
    h.update(
      graphOf(record('root', null, ['a']), record('a', 'root', [], { agentStatus: 'working' })),
      null,
      null,
      'isla'
    )
  }

  it('hands each label its own perspective-scaled drop and keeps the base drop when far away', () => {
    const h = harness()
    twoWorkingNodes(h)
    const [rootLabel, aLabel] = h.labels as [NodeLabelHandle, NodeLabelHandle]

    // 1px/unit everywhere is far below the isla calibration -> base 26px drop for all
    h.view.resolveLabelOverlaps(
      scaledProjection(
        () => 0,
        () => 1
      )
    )
    expect(rootLabel.setDropPx).toHaveBeenLastCalledWith(26)
    expect(aLabel.setDropPx).toHaveBeenLastCalledWith(26)

    // 200px/unit is far above calibration -> clamped to the max factor
    h.view.resolveLabelOverlaps(
      scaledProjection(
        () => 0,
        () => 200
      )
    )
    expect(rootLabel.setDropPx).toHaveBeenLastCalledWith(26 * LABEL_DROP_MAX_FACTOR)
  })

  it('collision rects use the scaled drop: a near label dropped further no longer overlaps', () => {
    const h = harness()
    twoWorkingNodes(h)
    const [rootLabel, aLabel] = h.labels as [NodeLabelHandle, NodeLabelHandle]
    const rootX = rootLabel.object.position.x
    // root (priority 1) anchor y=100, far scale -> rect 126..142.
    // a (priority 2) anchor y=60, near scale -> drop 65 -> rect 125..141: overlaps root -> root hidden.
    // With a flat 26 drop a would sit at 86..102 and clear root, so hiding proves the scaled rect.
    const near = scaledProjection(
      (x) => (x === rootX ? 100 : 60),
      (x) => (x === rootX ? 1 : 200)
    )
    h.view.resolveLabelOverlaps(near)
    expect(rootLabel.object.visible).toBe(false)
    expect(aLabel.object.visible).toBe(true)
  })
})

describe('resolveLabelOverlaps', () => {
  it('hides the lower-priority label when two eligible labels overlap on screen', () => {
    const h = harness()
    const graph = graphOf(
      record('root', null, ['a', 'b']),
      record('a', 'root', [], { agentStatus: 'working' }),
      record('b', 'root', [])
    )
    h.update(graph, null, null, 'isla') // root: main (priority 1); a: working (priority 2); b: idle — not eligible

    h.view.resolveLabelOverlaps(collapsingProjection())

    const [rootLabel, aLabel] = h.labels as [NodeLabelHandle, NodeLabelHandle]
    expect(rootLabel.object.visible).toBe(false)
    expect(aLabel.object.visible).toBe(true)
  })

  it('a subsequent update() does not resurrect a label hidden by collision', () => {
    const h = harness()
    const graph = graphOf(
      record('root', null, ['a', 'b']),
      record('a', 'root', [], { agentStatus: 'working' }),
      record('b', 'root', [])
    )
    h.update(graph, null, null, 'isla')
    h.view.resolveLabelOverlaps(collapsingProjection())
    expect(h.labels[0]!.object.visible).toBe(false)

    h.update(graph, null, null, 'isla')

    expect(lastLabelModel(h.labels, 0).visible).toBe(false)
  })

  it('a node hidden by the height policy never becomes a collision candidate', () => {
    const h = harness()
    const graph = baseGraph() // root -> (a, b); root is main
    h.update(graph, 'a', null, 'isla') // a is merely selected (priority 4) but not eligible at isla

    h.view.resolveLabelOverlaps(collapsingProjection())

    const [rootLabel, aLabel] = h.labels as [NodeLabelHandle, NodeLabelHandle]
    expect(rootLabel.object.visible).toBe(true) // survives despite a's higher priority — a was never a candidate
    expect(aLabel.object.visible).toBe(false)
  })

  it('at foco (one eligible label) nothing is ever hidden', () => {
    const h = harness()
    const graph = baseGraph()
    h.update(graph, 'a', null, 'foco') // only 'a' is eligible

    h.view.resolveLabelOverlaps(collapsingProjection())

    expect(h.labels[1]!.object.visible).toBe(true)
  })

  it('dropNode clears the id from the hidden set — a recreated id starts unhidden', () => {
    const h = harness()
    const withLoser = graphOf(
      record('root', null, ['winner', 'loser']),
      record('winner', 'root', [], { agentStatus: 'working' }),
      record('loser', 'root', [], { agentStatus: 'working' })
    )
    h.update(withLoser, 'winner', null, 'isla') // winner: selected (priority 4); loser: working (priority 2)

    const halfSumOf = (): number =>
      (labelBoxPx(lastLabelModel(h.labels, 1)).width +
        labelBoxPx(lastLabelModel(h.labels, 2)).width) /
      2

    const winnerZ1 = h.view.nodeCenter('winner')!.z
    const loserZ1 = h.view.nodeCenter('loser')!.z
    h.view.resolveLabelOverlaps(affineProjectionBetween(winnerZ1, loserZ1, halfSumOf() - 6))
    expect(h.labels[2]!.object.visible).toBe(false) // hidden: 6px overlap exceeds the dead band

    const withoutLoser = graphOf(
      record('root', null, ['winner']),
      record('winner', 'root', [], { agentStatus: 'working' })
    )
    h.update(withoutLoser, 'winner', null, 'isla') // drops 'loser' — must clear it from hiddenByCollision

    const recreated = graphOf(
      record('root', null, ['winner', 'loser']),
      record('winner', 'root', [], { agentStatus: 'working' }),
      record('loser', 'root', [], { agentStatus: 'working' })
    )
    h.update(recreated, 'winner', null, 'isla')
    const winnerZ2 = h.view.nodeCenter('winner')!.z
    const loserZ2 = h.view.nodeCenter('loser')!.z
    h.view.resolveLabelOverlaps(affineProjectionBetween(winnerZ2, loserZ2, halfSumOf() - 3))

    expect(h.labels.at(-1)!.object.visible).toBe(true) // fresh id, not pre-hidden — 3px overlap stays in the dead band
  })
})

// Both nodes project to x=400; each cube corner sits `ground.y * 5` px above its anchor row.
const rows = (rootX: number, rootY: number, aY: number): LabelAnchorProjection => {
  return (ground) => {
    const base = ground.x === rootX ? rootY : aY
    return { x: 400 + (ground.z - ground.x) * 0.001, y: base - ground.y * 5, visible: true }
  }
}

describe('resolveLabelOverlaps cube obstacles', () => {
  const twoNodes = (h: Harness): void => {
    h.view.setResolution(800, 900)
    h.update(
      graphOf(record('root', null, ['a']), record('a', 'root', [], { agentStatus: 'working' })),
      null,
      null,
      'isla'
    )
  }
  it('hides a label that lands on ANOTHER node cube even when no label overlaps it', () => {
    const h = harness()
    twoNodes(h)
    const [rootLabel, aLabel] = h.labels as [NodeLabelHandle, NodeLabelHandle]
    const rootX = rootLabel.object.position.x
    // root label rect 126..142; a's cube spans ~131..136 (anchor 136, height ~4.5px) -> covers it.
    h.view.resolveLabelOverlaps(rows(rootX, 100, 136))
    expect(rootLabel.object.visible).toBe(false)
    expect(aLabel.object.visible).toBe(true)
  })

  it('keeps both labels when each cube clears the other label', () => {
    const h = harness()
    twoNodes(h)
    const [rootLabel, aLabel] = h.labels as [NodeLabelHandle, NodeLabelHandle]
    const rootX = rootLabel.object.position.x
    h.view.resolveLabelOverlaps(rows(rootX, 100, 400))
    expect(rootLabel.object.visible).toBe(true)
    expect(aLabel.object.visible).toBe(true)
  })

  it('runs the pass with a single eligible label when another node cube covers it', () => {
    const h = harness()
    h.view.setResolution(800, 900)
    h.update(
      graphOf(record('root', null, ['a']), record('a', 'root', [], { agentStatus: 'working' })),
      'a',
      null,
      'foco'
    )
    const [rootLabel, aLabel] = h.labels as [NodeLabelHandle, NodeLabelHandle]
    const aX = aLabel.object.position.x
    // only 'a' is eligible at foco; root's cube is placed over a's label (rect 126..142 at aY=100)
    h.view.resolveLabelOverlaps((ground) => ({
      x: 400 + (ground.z - ground.x) * 0.001,
      y: (ground.x === aX ? 100 : 134) - ground.y * 5,
      visible: true
    }))
    expect(rootLabel.object.visible).toBe(false)
    expect(aLabel.object.visible).toBe(false)
  })
})
