import type { SceneStore } from '../../application/scene-store'
import { isTextEntryTarget, resolveNavCommand } from '../navigation/keymap'
import { islandEntrySelection, moveSelection } from '../navigation/selection-model'
import { islandLanding } from '../../application/island-focus'
import { cycleIsland, nextIsland } from '../../application/repos-model'
import { compareLitterMembers } from '../../application/compare-litter'
import { t } from '../../application/i18n/translate'
import { stepCompareFocus } from '../../application/compare-view-model'
import { stepDiffSelection } from '../../application/diff-view-model'
import type { CameraHeightController } from './camera-height-controller'

/** Framework-agnostic input — a real KeyboardEvent is structurally adapted onto this by `attach`. */
export type KeyboardControllerEvent = {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  target: { tagName: string; isContentEditable: boolean } | null
}

/** The terminal-panel-controller operations the keyboard layer delegates to (design Area 8) —
 *  a narrow structural subset, like `CameraHeightController` below. */
export type TerminalCommandPort = {
  focusActivePanel(): void
  closeActiveSession(): void
}

/** The diff live loader's select — the rail selection must go through it so the panel fetches. */
export type DiffSelectPort = {
  select(path: string): void
}

/** The delete-worktree confirm flow: `request` opens it; the keyboard layer must not act while it is open. */
export type WorktreeDeletePort = {
  request(nodeId: string): void
  isOpen(): boolean
  /** True when it closed the panel (false while a removal is running or when idle). */
  cancel(): boolean
}

/** Quick-open picker + file pane: while open it owns the keyboard (only Esc is routed to it). */
export type FileWorkspacePort = {
  openPicker(nodeId: string): void
  openFile(nodeId: string, path: string): void
  isOpen(): boolean
  /** True when it consumed the key (closed, or asked to confirm discarding edits). */
  requestClose(): boolean
}

export type KeyboardControllerDeps = {
  store: SceneStore
  heights: CameraHeightController
  terminal: TerminalCommandPort
  diff: DiffSelectPort
  worktreeDelete: WorktreeDeletePort
  fileWorkspace: FileWorkspacePort
  /** Mac vs. Linux/Windows — selects the ⌘P/Ctrl+P chord (PROJ-005). */
  platform: { isMac: boolean }
  /** Localized one-line hint for a key that is valid but has nothing to act on yet. */
  notice?: (message: string) => void
}

export type KeyboardController = {
  /** Returns true when a command was resolved and acted on — `attach` uses it to decide
   *  whether to suppress the key's default browser behavior (e.g. Tab's focus traversal). */
  handleKeyDown(event: KeyboardControllerEvent): boolean
  /** Thin DOM wiring — untested logic lives only here. Returns a detach function. */
  attach(target: DomKeydownTarget): () => void
}

type DomKeydownTarget = {
  addEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void
  removeEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void
}

/**
 * Wires keymap + selection-model to the store and an injected camera-height controller.
 * `h/j/k/l` move the selection (or cycle islands in `general`); `f`/`v` drive the camera
 * height. No camera math lives here — it all delegates to `heights`.
 */
export function createKeyboardController(deps: KeyboardControllerDeps): KeyboardController {
  const { store, heights, terminal, diff, worktreeDelete, fileWorkspace, platform } = deps

  const handleKeyDown = (event: KeyboardControllerEvent): boolean => {
    const command = resolveNavCommand(
      event.key,
      { alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey },
      platform
    )
    // Why: a modal opened over the file pane would steal focus from the editor.
    if (
      (command?.kind === 'open-projects' || command?.kind === 'open-palette') &&
      fileWorkspace.isOpen()
    ) {
      return true
    }
    // ⌘P/Ctrl+P must open the selector even while a terminal (a text-entry target) is focused
    // (PROJ-008) — checked before the text-entry gate below, unlike every other command.
    if (command?.kind === 'open-projects') {
      store.dispatchProjectSelector({ type: 'open' })
      return true
    }
    // ⌘K/Ctrl+K must open the palette even while a terminal is focused, same exception as
    // open-projects above; closing the selector/spawn menu first keeps only one modal live.
    if (command?.kind === 'open-palette') {
      store.dispatchProjectSelector({ type: 'close' })
      store.dispatchSpawn({ type: 'cancel' })
      store.dispatchCommandPalette({ type: 'open' })
      return true
    }
    if (event.target && isTextEntryTarget(event.target.tagName, event.target.isContentEditable)) {
      // Covers xterm.js's hidden helper textarea too (TEXT_ENTRY_TAGS includes TEXTAREA) — while
      // a terminal is focused, every other keystroke (incl. Esc) reaches the PTY, never the graph.
      return false
    }
    if (fileWorkspace.isOpen()) {
      if (command?.kind === 'escape') fileWorkspace.requestClose()
      return true
    }
    if (!command) {
      return false
    }
    // System and diff still REPLACE the scene: every command is a handled no-op except
    // 'close-scene-mode' (bare g) and 'escape' (routed through the ladder below). ⌘K/⌘P already
    // returned above, unaffected by this gate.
    const systemOpen = store.get().systemView.view === 'open'
    const diffOpen = store.get().diffView.view === 'open'
    const compareView = store.get().compareView
    const compareOpen = compareView.view === 'open'
    const diffView = store.get().diffView
    if ((systemOpen || diffOpen) && command.kind !== 'escape') {
      // j/k walk the diff rail (l/j = next, h/k = previous, same mapping as compare's rail).
      if (command.kind === 'move' && diffView.view === 'open') {
        const step = command.direction === 'child' || command.direction === 'next-sibling' ? 1 : -1
        const next = stepDiffSelection(diffView.files, diffView.selectedPath, step)
        if (next !== null) diff.select(next)
      }
      // x/d switch between the two scene-replacing modes on the same node; the key of the mode
      // already open stays a handled no-op.
      const selectedId = store.get().selection.selectedId
      if (command.kind === 'open-system' && diffOpen && selectedId !== null) {
        store.dispatchDiffView({ type: 'close' })
        store.dispatchSystemView({ type: 'open', nodeId: selectedId })
      }
      if (command.kind === 'open-diff' && systemOpen && selectedId !== null) {
        store.dispatchSystemView({ type: 'close' })
        store.dispatchDiffView({ type: 'open', nodeId: selectedId, baseRef: '' })
      }
      if (
        (command.kind === 'open-file' || command.kind === 'descend-island') &&
        diffView.view === 'open'
      ) {
        if (diffView.selectedPath !== null) {
          fileWorkspace.openFile(diffView.focusedNodeId, diffView.selectedPath)
        } else if (command.kind === 'open-file') {
          fileWorkspace.openPicker(diffView.focusedNodeId)
        }
      }
      if (command.kind === 'close-scene-mode') {
        if (systemOpen) store.dispatchSystemView({ type: 'close' })
        if (diffOpen) store.dispatchDiffView({ type: 'close' })
        if (compareOpen) store.dispatchCompareView({ type: 'close' })
      }
      return true
    }
    // Compare is a SIDE panel: the scene stays live, so hjkl/arrows drive the litter focus
    // (which the ring follows, design D3) instead of being swallowed. f/v stay swallowed — a
    // second height while the panel owns the screen would desync the Esc pose stack (design C5).
    if (compareOpen && command.kind !== 'escape') {
      if (command.kind === 'close-scene-mode') {
        store.dispatchCompareView({ type: 'close' })
        return true
      }
      if (command.kind === 'move' && compareView.view === 'open') {
        const step = command.direction === 'child' || command.direction === 'next-sibling' ? 1 : -1
        const next = stepCompareFocus(compareView.members, compareView.focusedChildId, step)
        if (next !== null) store.dispatchCompareView({ type: 'focus-child', childId: next })
      }
      return true
    }
    if (command.kind === 'delete-worktree') {
      // Handled-but-inert while any modal owns the keyboard, so Backspace never double-fires.
      if (
        worktreeDelete.isOpen() ||
        store.get().commandPalette.view !== 'closed' ||
        store.get().projectSelector.view !== 'closed' ||
        store.get().spawnMenu.view !== 'closed'
      ) {
        return true
      }
      const selectedId = store.get().selection.selectedId
      if (selectedId === null) return false
      worktreeDelete.request(selectedId)
      return true
    }
    if (command.kind === 'open-file') {
      if (
        store.get().commandPalette.view !== 'closed' ||
        store.get().projectSelector.view !== 'closed' ||
        store.get().spawnMenu.view !== 'closed' ||
        worktreeDelete.isOpen()
      ) {
        return true
      }
      const selectedId = store.get().selection.selectedId
      if (selectedId === null) return false
      fileWorkspace.openPicker(selectedId)
      return true
    }
    if (command.kind === 'move') {
      // Radial open: arrow/hjkl "cycle the active chip" (SPAWN-005) — v1 ships a single
      // enabled chip, so this is a handled no-op that must not drag the graph selection
      // out from under the anchored menu.
      if (store.get().spawnMenu.view === 'radial') return true
      // general repurposes hjkl/arrows to island-cycling (KEY-07): child/next-sibling (l/j)
      // step forward, parent/prev-sibling (h/k) step backward. Always handled, even with 0/1 repos.
      if (heights.current() === 'general') {
        const step = command.direction === 'child' || command.direction === 'next-sibling' ? 1 : -1
        const repos = store.get().repos
        const next = cycleIsland(repos.list, repos.activeRepoId, step)
        if (next !== null) {
          store.dispatchRepos({ type: 'set-active', repoId: next })
          heights.reanchorIsland(next)
        }
        return true
      }
      const graph = store.get().graph
      const current = store.get().selection.selectedId
      const next =
        current === null
          ? islandEntrySelection(graph, store.get().repos.activeRepoId)
          : moveSelection(graph, current, command.direction)
      if (next !== current) store.select(next)
      heights.onSelectionChanged(next)
      return true
    }
    if (command.kind === 'set-height') {
      heights.goTo(command.height)
      return true
    }
    if (command.kind === 'descend-island') {
      // Enter only descends FROM general (KEY-04) — outside it, unbound.
      if (heights.current() !== 'general') return false
      const repoId = store.get().repos.activeRepoId
      const { graph, selection, islandSelections } = store.get()
      const landing =
        repoId === null
          ? islandEntrySelection(graph, null)
          : islandLanding(graph, repoId, selection.selectedId, islandSelections)
      heights.goTo('isla')
      if (landing !== null) store.select(landing)
      return true
    }
    if (command.kind === 'open-terminal') {
      const selectedId = store.get().selection.selectedId
      if (selectedId === null) return false
      const forceNew = command.forceNew === true
      const activePanel = store.get().terminals.activePanel
      // Why: with no host (demo) nothing would mount, yet the panel state would swap the key hints.
      if (activePanel === null && store.get().connection.state !== 'connected') return false
      if (!forceNew && activePanel?.nodeId === selectedId) {
        store.dispatchTerminal({ type: 'set-focused', focused: true })
      } else {
        store.dispatchTerminal({ type: 'open-terminal-for-node', nodeId: selectedId, forceNew })
      }
      terminal.focusActivePanel()
      return true
    }
    if (command.kind === 'pin-terminal') {
      const activePanel = store.get().terminals.activePanel
      if (!activePanel) return false
      store.dispatchTerminal({
        type: 'set-placement',
        placement: activePanel.placement === 'scene' ? 'hud' : 'scene'
      })
      return true
    }
    if (command.kind === 'next-terminal') {
      // Tab precedence: palette > selector > terminal > island. Each modal's own query input is
      // a text-entry target already caught above; this is belt-and-suspenders for any other case.
      if (store.get().commandPalette.view !== 'closed') return true
      if (store.get().projectSelector.view !== 'closed') return true
      const activePanel = store.get().terminals.activePanel
      if (activePanel) {
        store.dispatchTerminal({ type: 'next-tab', nodeId: activePanel.nodeId })
        return true
      }
      const repos = store.get().repos
      const next = nextIsland(repos.list, repos.activeRepoId)
      if (next === null) return false
      store.dispatchRepos({ type: 'set-active', repoId: next })
      heights.reanchorIsland(next)
      return true
    }
    if (command.kind === 'open-spawn') {
      const spawnMenu = store.get().spawnMenu
      if (spawnMenu.view === 'radial') {
        store.dispatchSpawn({ type: 'radial-select' })
        return true
      }
      if (spawnMenu.view === 'form') return false
      const selectedId = store.get().selection.selectedId
      store.dispatchSpawn(
        selectedId !== null
          ? { type: 'open-for-node', nodeId: selectedId }
          : { type: 'open-rootless' }
      )
      return true
    }
    if (command.kind === 'open-fan-out') {
      const selectedId = store.get().selection.selectedId
      if (selectedId === null) return false
      // The radial's F chip: leaving it open would stack its chips over the fan-out form.
      if (store.get().spawnMenu.view === 'radial') store.dispatchSpawn({ type: 'cancel' })
      store.dispatchFanOut({ type: 'open-for-node', nodeId: selectedId })
      return true
    }
    if (command.kind === 'open-system') {
      const selectedId = store.get().selection.selectedId
      if (selectedId === null) return false
      store.dispatchSystemView({ type: 'open', nodeId: selectedId })
      return true
    }
    if (command.kind === 'open-diff') {
      const selectedId = store.get().selection.selectedId
      if (selectedId === null) return false
      // baseRef placeholder — bind-diff-view's loader.start() resolves the real base ref and
      // re-dispatches 'open' synchronously right after (harmless re-dispatch, mirrors how
      // system-live-driver.start() re-dispatches 'open' for the system view).
      store.dispatchDiffView({ type: 'open', nodeId: selectedId, baseRef: '' })
      return true
    }
    if (command.kind === 'open-compare') {
      // Anchors on the litter (running fan-out, else the one remembered across a reload), not on
      // the selection.
      const litter = compareLitterMembers(store.get())
      if (litter.length === 0) {
        if (!deps.notice) return false
        deps.notice(t('compare.noLitter'))
        return true
      }
      store.dispatchCompareView({ type: 'open', members: litter })
      return true
    }
    if (command.kind === 'close-scene-mode') {
      // Only meaningful while open — that case already returned above via the scene-mode gate.
      return false
    }
    // command.kind === 'escape' — palette-close wins over selector/spawn/system/diff/compare/
    // terminal-close, then selector-close wins over spawn/system/diff/compare/terminal-close
    // (PROJ-008); each modal's own query/path input already intercepts Escape above, this is
    // belt-and-suspenders.
    if (worktreeDelete.isOpen()) {
      worktreeDelete.cancel()
      return true
    }
    if (store.get().commandPalette.view !== 'closed') {
      store.dispatchCommandPalette({ type: 'close' })
      return true
    }
    if (store.get().projectSelector.view !== 'closed') {
      store.dispatchProjectSelector({ type: 'close' })
      return true
    }
    if (store.get().spawnMenu.view !== 'closed') {
      store.dispatchSpawn({ type: 'cancel' })
      return true
    }
    if (store.get().systemView.view === 'open') {
      store.dispatchSystemView({ type: 'close' })
      return true
    }
    if (store.get().diffView.view === 'open') {
      store.dispatchDiffView({ type: 'close' })
      return true
    }
    if (store.get().compareView.view === 'open') {
      store.dispatchCompareView({ type: 'close' })
      return true
    }
    if (store.get().terminals.activePanel) {
      terminal.closeActiveSession()
      return true
    }
    return heights.pop()
  }

  const attach = (target: DomKeydownTarget): (() => void) => {
    const onKeyDown = (domEvent: KeyboardEvent): void => {
      const element = domEvent.target instanceof HTMLElement ? domEvent.target : null
      const handled = handleKeyDown({
        key: domEvent.key,
        altKey: domEvent.altKey,
        ctrlKey: domEvent.ctrlKey,
        metaKey: domEvent.metaKey,
        shiftKey: domEvent.shiftKey,
        target: element
          ? { tagName: element.tagName, isContentEditable: element.isContentEditable }
          : null
      })
      // Tab's default browser behavior (focus traversal) would otherwise fight next-terminal;
      // Ctrl+P/Cmd+P would otherwise open the browser's print dialog (PROJ-005), and Ctrl+K/Cmd+K
      // the browser/address-bar search (Chrome/Safari) or Firefox's quick-find.
      const isBrowserChord =
        (domEvent.ctrlKey || domEvent.metaKey) && (domEvent.key === 'p' || domEvent.key === 'k')
      // Why: the handled s/o/t/shift+f/shift+t focus a form field or the terminal
      // synchronously, so the key's own input would otherwise land in it.
      const opensFormField =
        !domEvent.ctrlKey &&
        !domEvent.metaKey &&
        (domEvent.key === 's' ||
          domEvent.key === 'o' ||
          domEvent.key === 't' ||
          (domEvent.shiftKey && ['f', 't'].includes(domEvent.key.toLowerCase())))
      const isDeleteKey = domEvent.key === 'Backspace' || domEvent.key === 'Delete'
      if (handled && (domEvent.key === 'Tab' || isBrowserChord || opensFormField || isDeleteKey)) {
        domEvent.preventDefault()
      }
    }
    target.addEventListener('keydown', onKeyDown)
    return () => target.removeEventListener('keydown', onKeyDown)
  }

  return { handleKeyDown, attach }
}
