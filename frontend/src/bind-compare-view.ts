import { createCompareViewController } from './presentation/compare/compare-view-controller'
import { createCompareRail } from './presentation/compare/compare-rail-element'
import type { CompareRailHandle } from './presentation/compare/compare-rail-element'
import { createDiffRail } from './presentation/diff/diff-rail-element'
import type { DiffRailHandle } from './presentation/diff/diff-rail-element'
import { createDiffPanel } from './presentation/diff/diff-panel-element'
import type { DiffPanelHandle } from './presentation/diff/diff-panel-element'
import { createCompareHud } from './presentation/compare/compare-hud-element'
import type { CompareHudHandle } from './presentation/compare/compare-hud-element'
import { createCompareMergeAction } from './presentation/compare/compare-merge-action-element'
import type { CompareMergeActionHandle } from './presentation/compare/compare-merge-action-element'
import { createCompareLiveLoader } from './application/compare-live-loader'
import type { CompareLiveLoaderGatewayPort } from './application/compare-live-loader'
import { runCompareMerge } from './application/compare-merge-run'
import type { CompareMergeGatewayPort } from './application/compare-merge-run'
import {
  GIT_MERGE_WINNER_CAPABILITY,
  GIT_MERGE_WINNER_SYNC_CAPABILITY
} from './application/runtime-capability-keys'
import { fanOutMemberIds, fanOutParentId } from './application/fan-out-model'
import type { SceneState, SceneStore } from './application/scene-store'
import type { CameraHeightController } from './presentation/input/camera-height-controller'
import type { WorktreeId } from './domain/worktree-graph/types'

type CompareGatewayPort = CompareLiveLoaderGatewayPort & CompareMergeGatewayPort

export type BindCompareViewDeps = {
  store: SceneStore
  compareSlot: { appendChild(element: unknown): void }
  keyboardBarSlot: { appendChild(element: unknown): void }
  demoGateway: CompareGatewayPort
  heights: Pick<CameraHeightController, 'goToCamada' | 'refitCamada' | 'pop'>
  /** DOM element factory overrides — tests substitute fakes, production uses the defaults. */
  createChildRail?: () => CompareRailHandle
  createFileRail?: () => DiffRailHandle
  createPanel?: () => DiffPanelHandle
  createHud?: () => CompareHudHandle
  createMergeAction?: () => CompareMergeActionHandle
}

export type CompareViewBinder = {
  sync(): void
  /** Window or panel resize while open: re-fit the camada to the new aspect. Guarded on BOTH
   *  `pushedHeight` and the slice still being open, because main.ts remeasures BEFORE this
   *  binder syncs — on the open edge a refit would move the camera before goToCamada captures
   *  rig.currentPose(), and Esc would then restore the refit pose instead of the user's. */
  onViewportResize(): void
  rebindGateway(gateway: CompareGatewayPort, capabilities: readonly string[]): void
}

/** The camada's members for camera framing: the fan-out parent first (if one exists), then the
 *  compare litter — matches C6's worked "parent + children" fixture. */
const camadaIds = (state: SceneState): readonly WorktreeId[] => {
  const parentId = fanOutParentId(state.fanOut)
  const members = state.compareView.view === 'open' ? state.compareView.members : []
  return parentId === null ? members : [parentId, ...members]
}

/**
 * Extracted out of main.ts (max-lines ratchet, mirrors bind-diff-view.ts): builds the compare-
 * view controller + live loader once, starts/stops the loader on the compareView open/close
 * transition (detected by comparing against the previous sync's view). Focus/winner/select
 * clicks from the controller route straight to the store/loader here, keeping
 * compare-view-controller.ts itself free of store and loader knowledge. Worktree-chrome
 * hide/show is owned by main.ts's subscribe loop (order-independent with the other binders), not
 * by onEnter/onExit here — keeping only the DOM-scoped #compare mount/unmount lifecycle.
 */
export function createCompareViewBinder(deps: BindCompareViewDeps): CompareViewBinder {
  const loader = createCompareLiveLoader({ store: deps.store, gateway: deps.demoGateway })
  let mergeGateway: CompareMergeGatewayPort = deps.demoGateway
  let capabilities: readonly string[] = []

  const controller = createCompareViewController({
    createChildRail: deps.createChildRail ?? createCompareRail,
    createFileRail: deps.createFileRail ?? createDiffRail,
    createPanel: deps.createPanel ?? createDiffPanel,
    createHud: deps.createHud ?? createCompareHud,
    createMergeAction: deps.createMergeAction ?? createCompareMergeAction,
    hud: deps.compareSlot,
    keyboardBarSlot: deps.keyboardBarSlot,
    onFocusChild: (childId) => deps.store.dispatchCompareView({ type: 'focus-child', childId }),
    onSetWinner: (winnerId) => deps.store.dispatchCompareView({ type: 'set-winner', winnerId }),
    onSelectFile: (path) => {
      const compareView = deps.store.get().compareView
      if (compareView.view !== 'open' || compareView.focusedChildId === null) return
      loader.select(compareView.focusedChildId, path)
    },
    onMergeWinner: (syncWorkingTree) => {
      const state = deps.store.get()
      void runCompareMerge(
        state.compareView,
        state.fanOut,
        {
          gateway: mergeGateway,
          dispatch: (action) => deps.store.dispatchCompareView(action),
          graph: state.graph
        },
        syncWorkingTree
      )
    }
  })

  let wasOpen = false
  let pushedHeight = false

  const branchLabelFor = (childId: WorktreeId): string =>
    deps.store.get().graph.nodes.get(childId)?.branch ?? childId

  // Why: compare snapshots the litter on open; children created afterwards must join live.
  function adoptLateChildren(): void {
    const { compareView, fanOut } = deps.store.get()
    if (compareView.view !== 'open' || fanOut.view !== 'running') return
    const late = fanOutMemberIds(fanOut)
      .slice(1)
      .filter((id) => !(id in compareView.childLoads))
    if (late.length === 0) return
    deps.store.dispatchCompareView({ type: 'members-added', members: late })
    loader.add(late)
    if (pushedHeight) deps.heights.refitCamada(camadaIds(deps.store.get()))
  }

  return {
    sync(): void {
      adoptLateChildren()
      const state = deps.store.get()
      const { compareView } = state
      const isOpen = compareView.view === 'open'
      const transitionToOpen = isOpen && !wasOpen
      const transitionToClosed = !isOpen && wasOpen
      wasOpen = isOpen
      if (transitionToOpen && compareView.view === 'open') {
        loader.start(compareView.members)
        pushedHeight = deps.heights.goToCamada(camadaIds(state))
      }
      if (transitionToClosed) {
        loader.stop()
        if (pushedHeight) {
          deps.heights.pop()
          pushedHeight = false
        }
      }

      controller.sync(
        compareView,
        state.connection,
        branchLabelFor,
        capabilities.includes(GIT_MERGE_WINNER_CAPABILITY),
        capabilities.includes(GIT_MERGE_WINNER_SYNC_CAPABILITY)
      )
    },
    onViewportResize(): void {
      if (!pushedHeight) return
      const state = deps.store.get()
      if (state.compareView.view !== 'open') return
      deps.heights.refitCamada(camadaIds(state))
    },
    rebindGateway(gateway: CompareGatewayPort, nextCapabilities: readonly string[]): void {
      loader.rebindGateway(gateway)
      mergeGateway = gateway
      capabilities = nextCapabilities
    }
  }
}
