import { createDiffViewController } from './presentation/diff/diff-view-controller'
import { createDiffRail } from './presentation/diff/diff-rail-element'
import { createDiffPanel } from './presentation/diff/diff-panel-element'
import { createDiffHud } from './presentation/diff/diff-hud-element'
import { createDiffLiveLoader } from './application/diff-live-loader'
import type { DiffLiveLoaderGatewayPort } from './application/diff-live-loader'
import type { SceneStore } from './application/scene-store'
import type { StageState } from './application/source-control-flow'
import type { DiffRailHandle } from './presentation/diff/diff-rail-element'
import type { DiffPanelHandle } from './presentation/diff/diff-panel-element'
import type { DiffHudHandle } from './presentation/diff/diff-hud-element'

export type BindDiffViewDeps = {
  store: SceneStore
  diffSlot: { appendChild(element: unknown): void }
  keyboardBarSlot: { appendChild(element: unknown): void }
  demoGateway: DiffLiveLoaderGatewayPort
  /** DOM element factory overrides — tests substitute fakes, production uses the defaults. */
  createRail?: () => DiffRailHandle
  createPanel?: () => DiffPanelHandle
  createHud?: () => DiffHudHandle
}

/** Stage toggles on the rail rows; late-bound because source control is built after the diff binder. */
export type DiffStageSource = {
  stageStates(): ReadonlyMap<string, StageState> | undefined
  toggle(path: string): void
  /** Silent status re-read on every diff poll tick (ahead/behind, staged marks). */
  refreshStatus(): void
}

export type DiffViewBinder = {
  sync(): void
  /** Selects a rail file through the live loader (fetches its panel). */
  select(path: string): void
  /** Reloads the rail in place (after stage/commit), keeping the selected file. */
  refresh(): void
  attachStageSource(source: DiffStageSource): void
  rebindGateway(gateway: DiffLiveLoaderGatewayPort): void
}

/**
 * Extracted out of main.ts (max-lines ratchet, mirrors bind-system-view.ts): builds the
 * diff-view controller + live loader once, starts/stops/selects on that loader on the diffView
 * open/close/select transitions (detected by comparing against the previous sync's view).
 * Worktree-chrome hide/show is owned by main.ts's subscribe loop (order-independent with
 * bind-system-view.ts), not by onEnter/onExit here — keeping only the DOM-scoped #diff
 * mount/unmount lifecycle.
 */
export function createDiffViewBinder(deps: BindDiffViewDeps): DiffViewBinder {
  let stageSource: DiffStageSource | null = null
  const loader = createDiffLiveLoader({
    store: deps.store,
    gateway: deps.demoGateway,
    onPolled: () => stageSource?.refreshStatus()
  })

  const controller = createDiffViewController({
    createRail: deps.createRail ?? createDiffRail,
    createPanel: deps.createPanel ?? createDiffPanel,
    createHud: deps.createHud ?? createDiffHud,
    hud: deps.diffSlot,
    keyboardBarSlot: deps.keyboardBarSlot,
    onSelect: (path) => loader.select(path),
    onStageToggle: (path) => stageSource?.toggle(path)
  })

  let wasOpen = false

  return {
    sync(): void {
      const state = deps.store.get()
      const { diffView } = state
      const isOpen = diffView.view === 'open'
      const transitionToOpen = isOpen && !wasOpen
      const transitionToClosed = !isOpen && wasOpen
      wasOpen = isOpen
      // start() re-dispatches 'open' (harmless — nothing has run yet at this instant, mirrors
      // bind-system-view.ts), which re-enters sync() synchronously; wasOpen is already updated
      // above, so it won't recurse.
      if (transitionToOpen && diffView.view === 'open') loader.start(diffView.focusedNodeId)
      if (transitionToClosed) loader.stop()

      const selectedId = state.selection.selectedId
      const branchLabel =
        selectedId !== null ? (state.graph.nodes.get(selectedId)?.branch ?? '') : ''
      controller.sync(
        deps.store.get().diffView,
        state.connection,
        branchLabel,
        stageSource?.stageStates()
      )
    },
    select(path: string): void {
      loader.select(path)
    },
    refresh(): void {
      loader.refresh()
    },
    attachStageSource(source): void {
      stageSource = source
    },
    rebindGateway(gateway: DiffLiveLoaderGatewayPort): void {
      loader.rebindGateway(gateway)
    }
  }
}
