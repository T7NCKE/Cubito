import type { SceneStore } from '../../application/scene-store'
import type { WorktreeId } from '../../domain/worktree-graph/types'
import { frameAll, frameIsland } from '../camera/camera-framing'
import type { CameraFraming, Vec3 } from '../camera/camera-framing'
import { panPoseTo } from '../camera/camera-pose'
import type { CameraHeight, CameraPose } from '../camera/camera-pose'
import {
  COMPARAR_VIEW_DIRECTION,
  heightDurationMs,
  heightFov,
  poseForExtent,
  poseForGeneral,
  poseForHeight
} from '../camera/height-presets'
import { islandEntrySelection } from '../navigation/selection-model'
import { NODE_SIZE } from '../theme/scene-metrics'

/** The subset of camera-rig the controller drives — never the camera/frustum directly. */
export type CameraRigLike = {
  animateTo(pose: CameraPose, durationMs: number): void
  currentPose(): CameraPose
  currentAspect(): number
  isPointInView(point: Vec3, margin: number): boolean
}

/** Ground-truth node positions, supplied by whatever owns the THREE scene (graph-view). */
export type ScenePositions = {
  nodeCenter(id: WorktreeId): Vec3 | null
  nodeCenters(): Vec3[]
}

export type CameraHeightControllerDeps = {
  store: SceneStore
  rig: CameraRigLike
  scenePositions: ScenePositions
}

export type CameraHeightController = {
  current(): CameraHeight
  /** Re-anchors in place (no push) when `height` is already current; otherwise pushes the live
   *  pose and tweens. Returns whether it pushed. A no-op (missing anchor) also returns false. */
  goTo(height: CameraHeight): boolean
  /** comparar's real entry point: frames parent + litter along COMPARAR_VIEW_DIRECTION at the
   *  CURRENT aspect (design C6/D2), pushing like goTo. False (no push) when no member center
   *  resolves — frameAll([]) would otherwise fly the camera to the world origin. */
  goToCamada(memberIds: readonly WorktreeId[]): boolean
  /** Re-fits the same camada to a new aspect with durationMs 0 (a resize must not animate).
   *  NEVER pushes — the stack already holds the pre-compare pose. */
  refitCamada(memberIds: readonly WorktreeId[]): void
  /** Tweens back to the popped pose at the popped height's own duration. False on an empty stack. */
  pop(): boolean
  /** Tab/⌘P island activate: 'general' anchors on the galaxy centroid, so activating an island
   *  never moves the camera; every other height fits the island's extent. Never pushes. */
  reanchorIsland(repoId: string): void
  /** Fan-out litter reframe at the CURRENT fov, so a reframe never changes height. */
  animateToExtent(framing: CameraFraming, durationMs: number): void
  /** foco: always re-targets. isla: pans only when the selection left the frustum. Otherwise no-op. */
  onSelectionChanged(id: WorktreeId | null): void
}

type StackEntry = { height: CameraHeight; pose: CameraPose }

/** Owns the four-height pose stack (design escena-3d-alturas) — the only place camera-height
 *  math and the Esc-unwound push/pop history live. */
export function createCameraHeightController(
  deps: CameraHeightControllerDeps
): CameraHeightController {
  const { store, rig, scenePositions } = deps
  const stack: StackEntry[] = []

  const current = (): CameraHeight => store.get().camera.height

  const groundAnchor = (repoId: string | null): Vec3 | null => {
    const id = islandEntrySelection(store.get().graph, repoId)
    if (id === null) return null
    const center = scenePositions.nodeCenter(id)
    return center ? { x: center.x, y: 0, z: center.z } : null
  }

  const computePose = (height: CameraHeight): CameraPose | null => {
    if (height === 'foco') {
      const selectedId = store.get().selection.selectedId
      const selection = selectedId !== null ? scenePositions.nodeCenter(selectedId) : null
      if (selection === null) return null
      const anchor = groundAnchor(store.get().repos.activeRepoId) ?? { x: 0, y: 0, z: 0 }
      return poseForHeight('foco', anchor, selection)
    }
    if (height === 'general') {
      const centers = scenePositions.nodeCenters()
      return centers.length === 0 ? null : poseForGeneral(frameAll(centers), rig.currentAspect())
    }
    const anchor = groundAnchor(store.get().repos.activeRepoId)
    if (anchor === null) return null
    return poseForHeight(height, anchor, null)
  }

  /** Shared by goTo and goToCamada (design pinned code): re-anchors in place when `height` is
   *  already current, otherwise pushes the live pose and tweens to the new one. */
  const pushAndTween = (height: CameraHeight, pose: CameraPose): boolean => {
    const from = current()
    if (height === from) {
      rig.animateTo(pose, heightDurationMs(height))
      return false
    }
    stack.push({ height: from, pose: rig.currentPose() })
    rig.animateTo(pose, heightDurationMs(height))
    store.update({ camera: { height } })
    return true
  }

  const goTo = (height: CameraHeight): boolean => {
    const pose = computePose(height)
    if (pose === null) return false
    return pushAndTween(height, pose)
  }

  /** frameAll over the resolved member centers, along COMPARAR_VIEW_DIRECTION at the rig's
   *  live aspect (design C6/D2) — null when nothing resolves. */
  const camadaPose = (memberIds: readonly WorktreeId[]): CameraPose | null => {
    const centers = memberIds
      .map((id) => scenePositions.nodeCenter(id))
      .filter((c): c is Vec3 => c !== null)
    if (centers.length === 0) return null
    return poseForExtent(
      frameAll(centers),
      heightFov('comparar'),
      rig.currentAspect(),
      COMPARAR_VIEW_DIRECTION
    )
  }

  const goToCamada = (memberIds: readonly WorktreeId[]): boolean => {
    const pose = camadaPose(memberIds)
    if (pose === null) return false
    return pushAndTween('comparar', pose)
  }

  const refitCamada = (memberIds: readonly WorktreeId[]): void => {
    const pose = camadaPose(memberIds)
    if (pose === null) return
    rig.animateTo(pose, 0)
  }

  const pop = (): boolean => {
    const top = stack.pop()
    if (!top) return false
    rig.animateTo(top.pose, heightDurationMs(top.height))
    store.update({ camera: { height: top.height } })
    return true
  }

  const reanchorIsland = (repoId: string): void => {
    const height = current()
    // general's anchor is the whole-galaxy centroid — activating a different island can't move it.
    if (height === 'general') return
    const framing = frameIsland(store.get().graph, repoId, scenePositions.nodeCenter)
    rig.animateTo(poseForExtent(framing, rig.currentPose().fov), heightDurationMs(height))
  }

  const animateToExtent = (framing: CameraFraming, durationMs: number): void => {
    rig.animateTo(poseForExtent(framing, rig.currentPose().fov), durationMs)
  }

  const onSelectionChanged = (id: WorktreeId | null): void => {
    const height = current()
    if (height !== 'foco' && height !== 'isla') return
    const center = id !== null ? scenePositions.nodeCenter(id) : null
    if (center === null) return
    if (height === 'foco') {
      const anchor = groundAnchor(store.get().repos.activeRepoId) ?? { x: 0, y: 0, z: 0 }
      rig.animateTo(poseForHeight('foco', anchor, center), heightDurationMs('foco'))
      return
    }
    if (!rig.isPointInView(center, NODE_SIZE)) {
      rig.animateTo(panPoseTo(rig.currentPose(), center), heightDurationMs('isla'))
    }
  }

  return {
    current,
    goTo,
    goToCamada,
    refitCamada,
    pop,
    reanchorIsland,
    animateToExtent,
    onSelectionChanged
  }
}
