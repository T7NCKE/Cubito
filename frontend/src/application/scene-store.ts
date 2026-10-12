import type { FailureMessage } from './i18n/user-facing-error'
import { t } from './i18n/translate'
import { activateIsland, selectNode } from './island-focus'
import type { IslandFocus, IslandSelections } from './island-focus'
import { emptyWorktreeGraph } from '../domain/worktree-graph/types'
import type { WorktreeGraph, WorktreeId } from '../domain/worktree-graph/types'
import { DEFAULT_CAMERA_HEIGHT } from '../presentation/camera/camera-pose'
import type { CameraHeight } from '../presentation/camera/camera-pose'
import { emptyTerminalsState, reduceTerminals } from './terminal-session-model'
import type { TerminalAction, TerminalsState } from './terminal-session-model'
import { emptySpawnMenuSlice, reduceSpawnMenu } from './spawn-menu-model'
import type { SpawnMenuAction, SpawnMenuSlice } from './spawn-menu-model'
import { emptyReposSlice, reduceRepos } from './repos-model'
import type { ReposAction, ReposSlice } from './repos-model'
import { emptyProjectSelectorSlice, reduceProjectSelector } from './project-selector-model'
import type { ProjectSelectorAction, ProjectSelectorSlice } from './project-selector-model'
import { emptyCommandPaletteSlice, reduceCommandPalette } from './command-palette-model'
import type { CommandPaletteAction, CommandPaletteSlice } from './command-palette-model'
import { composeFanOutGraph, emptyFanOutSlice, reduceFanOut } from './fan-out-model'
import type { FanOutAction, FanOutSlice } from './fan-out-model'
import { emptySystemViewSlice, reduceSystemView } from './system-view-model'
import type { SystemViewAction, SystemViewSlice } from './system-view-model'
import { emptyDiffViewSlice, reduceDiffView } from './diff-view-model'
import type { DiffViewAction, DiffViewSlice } from './diff-view-model'
import { emptyCompareViewSlice, reduceCompareView } from './compare-view-model'
import type { CompareViewAction, CompareViewSlice } from './compare-view-model'

export type SyncStatus =
  | { state: 'idle' }
  | { state: 'syncing' }
  | { state: 'synced'; at: number }
  | { state: 'error'; code: string; message: FailureMessage }

export type ConnectionState =
  | { state: 'connecting' }
  | { state: 'connected'; runtimeId: string }
  | { state: 'reconnecting'; attempt: number; nextRetryInMs: number }
  | { state: 'down'; reason: string }

export type SceneState = {
  graph: WorktreeGraph
  sync: SyncStatus
  connection: ConnectionState
  selection: { selectedId: WorktreeId | null }
  terminals: TerminalsState
  spawnMenu: SpawnMenuSlice
  repos: ReposSlice
  projectSelector: ProjectSelectorSlice
  commandPalette: CommandPaletteSlice
  fanOut: FanOutSlice
  systemView: SystemViewSlice
  diffView: DiffViewSlice
  compareView: CompareViewSlice
  camera: { height: CameraHeight }
  /** Last pick per island, restored when it's re-activated (island-focus). */
  islandSelections: IslandSelections
  /** Fan-out children remembered across a reload so compare stays reachable (litter-memory.ts). */
  rememberedLitter: readonly WorktreeId[]
}

export type SceneStore = {
  get(): SceneState
  set(next: SceneState): void
  update(patch: Partial<SceneState>): void
  /** Drives the terminals slice through terminal-session-model's pure reducer, one notify. */
  dispatchTerminal(action: TerminalAction): void
  /** Drives the spawnMenu slice through spawn-menu-model's pure reducer, one notify. */
  dispatchSpawn(action: SpawnMenuAction): void
  /** Drives the repos slice through repos-model's pure reducer, one notify. */
  dispatchRepos(action: ReposAction): void
  /** Drives the projectSelector slice through project-selector-model's pure reducer, one notify. */
  dispatchProjectSelector(action: ProjectSelectorAction): void
  /** Drives the commandPalette slice through command-palette-model's pure reducer, one notify. */
  dispatchCommandPalette(action: CommandPaletteAction): void
  /** Drives the fanOut slice through fan-out-model's reducer and recomposes graph, one notify. */
  dispatchFanOut(action: FanOutAction): void
  /** Drives the systemView slice through system-view-model's reducer, one notify. Doesn't touch `graph`. */
  dispatchSystemView(action: SystemViewAction): void
  /** Drives the diffView slice through diff-view-model's reducer, one notify. Doesn't touch `graph`. */
  dispatchDiffView(action: DiffViewAction): void
  /** Drives the compareView slice through compare-view-model's reducer, one notify. Doesn't touch `graph`. */
  dispatchCompareView(action: CompareViewAction): void
  /** User pick; activates the pick's island when it lives elsewhere (island-focus). */
  select(selectedId: WorktreeId | null): void
  subscribe(listener: (state: SceneState) => void): () => void
}

const initialSceneState = (): SceneState => ({
  graph: emptyWorktreeGraph(),
  sync: { state: 'idle' },
  connection: { state: 'down', reason: t('connection.notConnected') },
  selection: { selectedId: null },
  terminals: emptyTerminalsState(),
  spawnMenu: emptySpawnMenuSlice(),
  repos: emptyReposSlice(),
  projectSelector: emptyProjectSelectorSlice(),
  commandPalette: emptyCommandPaletteSlice(),
  fanOut: emptyFanOutSlice(),
  systemView: emptySystemViewSlice(),
  diffView: emptyDiffViewSlice(),
  compareView: emptyCompareViewSlice(),
  camera: { height: DEFAULT_CAMERA_HEIGHT },
  islandSelections: new Map(),
  rememberedLitter: []
})

const focusOf = (s: SceneState): IslandFocus => ({
  activeRepoId: s.repos.activeRepoId,
  selectedId: s.selection.selectedId,
  islandSelections: s.islandSelections
})
const withFocus = (s: SceneState, f: IslandFocus): SceneState => ({
  ...s,
  repos: { ...s.repos, activeRepoId: f.activeRepoId },
  selection: { selectedId: f.selectedId },
  islandSelections: f.islandSelections
})

/** Minimal observable store; swap for a richer signal system when the UI grows. */
export function createSceneStore(): SceneStore {
  let state: SceneState = initialSceneState()
  const listeners = new Set<(state: SceneState) => void>()
  const notify = (): void => {
    for (const listener of [...listeners]) {
      listener(state)
    }
  }
  return {
    get: () => state,
    set(next) {
      state = next
      notify()
    },
    update(patch) {
      state = { ...state, ...patch }
      notify()
    },
    dispatchTerminal(action) {
      state = { ...state, terminals: reduceTerminals(state.terminals, action) }
      notify()
    },
    dispatchSpawn(action) {
      state = { ...state, spawnMenu: reduceSpawnMenu(state.spawnMenu, action) }
      notify()
    },
    dispatchRepos(action) {
      const repos = reduceRepos(state.repos, action)
      state =
        repos.activeRepoId === state.repos.activeRepoId
          ? { ...state, repos }
          : withFocus(
              { ...state, repos },
              activateIsland(state.graph, focusOf(state), repos.activeRepoId)
            )
      notify()
    },
    select(selectedId) {
      state = withFocus(state, selectNode(state.graph, focusOf(state), selectedId))
      notify()
    },
    dispatchProjectSelector(action) {
      state = { ...state, projectSelector: reduceProjectSelector(state.projectSelector, action) }
      notify()
    },
    dispatchCommandPalette(action) {
      state = { ...state, commandPalette: reduceCommandPalette(state.commandPalette, action) }
      notify()
    },
    dispatchFanOut(action) {
      const fanOut = reduceFanOut(state.fanOut, action)
      state = { ...state, fanOut, graph: composeFanOutGraph(state.graph, fanOut) }
      notify()
    },
    dispatchSystemView(action) {
      // [x] sistema, [d] diff and [c] compare are mutually exclusive scene modes — opening one
      // closes the OTHER TWO at this chokepoint so no caller (keyboard, palette, ...) can leave
      // more than one open.
      const opening = action.type === 'open'
      const diffView =
        opening && state.diffView.view === 'open'
          ? reduceDiffView(state.diffView, { type: 'close' })
          : state.diffView
      const compareView =
        opening && state.compareView.view === 'open'
          ? reduceCompareView(state.compareView, { type: 'close' })
          : state.compareView
      state = {
        ...state,
        systemView: reduceSystemView(state.systemView, action),
        diffView,
        compareView
      }
      notify()
    },
    dispatchDiffView(action) {
      const opening = action.type === 'open'
      const systemView =
        opening && state.systemView.view === 'open'
          ? reduceSystemView(state.systemView, { type: 'close' })
          : state.systemView
      const compareView =
        opening && state.compareView.view === 'open'
          ? reduceCompareView(state.compareView, { type: 'close' })
          : state.compareView
      state = {
        ...state,
        diffView: reduceDiffView(state.diffView, action),
        systemView,
        compareView
      }
      notify()
    },
    dispatchCompareView(action) {
      const opening = action.type === 'open'
      const systemView =
        opening && state.systemView.view === 'open'
          ? reduceSystemView(state.systemView, { type: 'close' })
          : state.systemView
      const diffView =
        opening && state.diffView.view === 'open'
          ? reduceDiffView(state.diffView, { type: 'close' })
          : state.diffView
      state = {
        ...state,
        compareView: reduceCompareView(state.compareView, action),
        systemView,
        diffView
      }
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}
