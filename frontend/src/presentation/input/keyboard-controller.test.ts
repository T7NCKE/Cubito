import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { createKeyboardController } from './keyboard-controller'
import type { KeyboardControllerEvent } from './keyboard-controller'
import type { CameraHeightController } from './camera-height-controller'
import type { CameraHeight } from '../camera/camera-pose'
import { createSceneStore } from '../../application/scene-store'
import { moveSelection } from '../navigation/selection-model'
import { inertActivity } from '../../domain/worktree-graph/node-activity'
import type { WorktreeGraph, WorktreeNode } from '../../domain/worktree-graph/types'

const node = (
  id: string,
  parentId: string | null,
  childIds: readonly string[],
  isMain = false
): WorktreeNode => ({
  id,
  repoId: 'repo',
  branch: id,
  path: `/tmp/${id}`,
  status: 'clean',
  isMain,
  kind: isMain ? 'root' : 'worktree',
  parentId,
  childIds,
  activity: inertActivity()
})

/** root -> [a, b, c] (fan of three, so clamp at the last/first sibling is exercisable). */
function buildFanGraph(): WorktreeGraph {
  const nodes = new Map<string, WorktreeNode>([
    ['root', node('root', null, ['a', 'b', 'c'], true)],
    ['a', node('a', 'root', [])],
    ['b', node('b', 'root', [])],
    ['c', node('c', 'root', [])]
  ])
  return { nodes, edges: [], rootIds: ['root'] }
}

function baseEvent(overrides: Partial<KeyboardControllerEvent>): KeyboardControllerEvent {
  return {
    key: '',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: null,
    ...overrides
  }
}

function fakeTerminalCommandPort() {
  return { focusActivePanel: vi.fn(), closeActiveSession: vi.fn() }
}

function fakeWorktreeDelete(open = false) {
  return { request: vi.fn(), isOpen: vi.fn(() => open), cancel: vi.fn(() => open) }
}

const LINUX = { isMac: false }
const MAC = { isMac: true }

/** All camera-height math is unit-tested against the real controller in
 *  camera-height-controller.test.ts — here the controller is a bare fake so keyboard-controller's
 *  own tests only assert WHICH heights method got called, never any camera math. */
function fakeHeights(): CameraHeightController {
  return {
    current: vi.fn((): CameraHeight => 'isla'),
    goTo: vi.fn(() => true),
    goToCamada: vi.fn(() => true),
    refitCamada: vi.fn(),
    pop: vi.fn(() => false),
    reanchorIsland: vi.fn(),
    animateToExtent: vi.fn(),
    onSelectionChanged: vi.fn()
  }
}

/** Drives fan-out-model's real reducer to a 'running' slice with real created children —
 *  open-compare anchors on this slice, not on graph/selection. */
function withRunningCamada(
  store: ReturnType<typeof createSceneStore>,
  parentId: string,
  childWorktreeIds: readonly string[]
): void {
  store.dispatchFanOut({ type: 'open-for-node', nodeId: parentId })
  store.dispatchFanOut({ type: 'set-repo-selector', repoSelector: 'id:repo-a' })
  const mutationIds = childWorktreeIds.map((_, i) => `m${i}`)
  store.dispatchFanOut({ type: 'submit', mutationIds })
  mutationIds.forEach((mutationId, i) => {
    store.dispatchFanOut({ type: 'child-created', mutationId, worktreeId: childWorktreeIds[i]! })
  })
}

function setup(selectedId: string | null = 'b', platform = LINUX) {
  const store = createSceneStore()
  store.update({
    graph: buildFanGraph(),
    selection: { selectedId },
    connection: { state: 'connected', runtimeId: 'r' }
  })
  const heights = fakeHeights()
  const terminal = fakeTerminalCommandPort()
  const diff = { select: vi.fn() }
  const worktreeDelete = fakeWorktreeDelete()
  const controller = createKeyboardController({
    store,
    heights,
    terminal,
    diff,
    worktreeDelete,
    fileWorkspace: {
      openPicker: vi.fn(),
      openFile: vi.fn(),
      isOpen: () => false,
      requestClose: () => false
    },
    platform
  })
  return { store, heights, terminal, diff, worktreeDelete, controller }
}

/** Two-island graph (repos 'r1'/'r2') for Tab island-cycling (PROJ-008). */
function buildTwoRepoGraph(): WorktreeGraph {
  const island = (id: string, repoId: string): WorktreeNode => ({
    ...node(id, null, []),
    repoId
  })
  const nodes = new Map<string, WorktreeNode>([
    ['x1', island('x1', 'r1')],
    ['y1', island('y1', 'r2')],
    ['y2', island('y2', 'r2')]
  ])
  return { nodes, edges: [], rootIds: ['x1', 'y1'] }
}

const REPO_1 = { id: 'r1', path: '/r1', displayName: 'R1', kind: 'git' as const }
const REPO_2 = { id: 'r2', path: '/r2', displayName: 'R2', kind: 'git' as const }

function setupWithRepos() {
  const store = createSceneStore()
  store.update({ graph: buildTwoRepoGraph(), selection: { selectedId: null } })
  store.dispatchRepos({ type: 'set-list', list: [REPO_1, REPO_2] })
  const heights = fakeHeights()
  const terminal = fakeTerminalCommandPort()
  const controller = createKeyboardController({
    store,
    heights,
    terminal,
    diff: { select: vi.fn() },
    worktreeDelete: fakeWorktreeDelete(),
    fileWorkspace: {
      openPicker: vi.fn(),
      openFile: vi.fn(),
      isOpen: () => false,
      requestClose: () => false
    },
    platform: LINUX
  })
  return { store, heights, terminal, controller }
}

describe('createKeyboardController — delete worktree', () => {
  it.each(['Backspace', 'Delete'])('%s requests deletion of the selected node', (key) => {
    const { controller, worktreeDelete } = setup('b')
    expect(controller.handleKeyDown(baseEvent({ key }))).toBe(true)
    expect(worktreeDelete.request).toHaveBeenCalledWith('b')
  })

  it('does nothing without a selection', () => {
    const { controller, worktreeDelete } = setup(null)
    expect(controller.handleKeyDown(baseEvent({ key: 'Backspace' }))).toBe(false)
    expect(worktreeDelete.request).not.toHaveBeenCalled()
  })

  it('ignores Backspace typed into a text field', () => {
    const { controller, worktreeDelete } = setup('b')
    const target = { tagName: 'TEXTAREA', isContentEditable: false }
    expect(controller.handleKeyDown(baseEvent({ key: 'Backspace', target }))).toBe(false)
    expect(worktreeDelete.request).not.toHaveBeenCalled()
  })

  it('is swallowed without a request while a scene mode owns the screen', () => {
    const { controller, store, worktreeDelete } = setup('b')
    store.dispatchDiffView({ type: 'open', nodeId: 'b', baseRef: 'root' })
    expect(controller.handleKeyDown(baseEvent({ key: 'Backspace' }))).toBe(true)
    expect(worktreeDelete.request).not.toHaveBeenCalled()
  })

  it.each(['palette', 'selector'])('does not fire while the %s is open', (modal) => {
    const { controller, store, worktreeDelete } = setup('b')
    if (modal === 'palette') store.dispatchCommandPalette({ type: 'open' })
    else store.dispatchProjectSelector({ type: 'open' })
    expect(controller.handleKeyDown(baseEvent({ key: 'Backspace' }))).toBe(true)
    expect(worktreeDelete.request).not.toHaveBeenCalled()
  })

  it('does not re-request while the confirm panel is already open, and Escape closes it first', () => {
    const store = createSceneStore()
    store.update({ graph: buildFanGraph(), selection: { selectedId: 'b' } })
    const worktreeDelete = fakeWorktreeDelete(true)
    const controller = createKeyboardController({
      store,
      heights: fakeHeights(),
      terminal: fakeTerminalCommandPort(),
      diff: { select: vi.fn() },
      worktreeDelete,
      fileWorkspace: {
        openPicker: vi.fn(),
        openFile: vi.fn(),
        isOpen: () => false,
        requestClose: () => false
      },
      platform: LINUX
    })
    expect(controller.handleKeyDown(baseEvent({ key: 'Backspace' }))).toBe(true)
    expect(worktreeDelete.request).not.toHaveBeenCalled()
    expect(controller.handleKeyDown(baseEvent({ key: 'Escape' }))).toBe(true)
    expect(worktreeDelete.cancel).toHaveBeenCalled()
  })
})

describe('createKeyboardController', () => {
  it('h delegates to moveSelection for "parent" — no parent-lookup logic of its own', () => {
    const { store, controller } = setup('b')
    const graph = store.get().graph
    const expected = moveSelection(graph, 'b', 'parent')

    controller.handleKeyDown(baseEvent({ key: 'h' }))

    expect(store.get().selection.selectedId).toBe(expected)
  })

  it('l/j/k delegate entirely to moveSelection, including clamp at fan boundaries', () => {
    const { store, controller } = setup('c') // 'c' is the last sibling of the fan
    const graph = store.get().graph

    // next-sibling ('j') at the last sibling clamps to itself — proves no boundary
    // logic is duplicated in the controller; it matches moveSelection byte for byte.
    const expectedJ = moveSelection(graph, 'c', 'next-sibling')
    controller.handleKeyDown(baseEvent({ key: 'j' }))
    expect(store.get().selection.selectedId).toBe(expectedJ)
    expect(expectedJ).toBe('c')

    const expectedL = moveSelection(graph, store.get().selection.selectedId, 'child')
    controller.handleKeyDown(baseEvent({ key: 'l' }))
    expect(store.get().selection.selectedId).toBe(expectedL)

    const expectedK = moveSelection(graph, store.get().selection.selectedId, 'prev-sibling')
    controller.handleKeyDown(baseEvent({ key: 'k' }))
    expect(store.get().selection.selectedId).toBe(expectedK)
  })

  it('f delegates to heights.goTo("foco") — no direct camera math here', () => {
    const { heights, controller } = setup('a')

    controller.handleKeyDown(baseEvent({ key: 'f' }))

    expect(heights.goTo).toHaveBeenCalledOnce()
    expect(heights.goTo).toHaveBeenCalledWith('foco')
  })

  it('v delegates to heights.goTo("general") — no direct camera math here', () => {
    const { heights, controller } = setup('a')

    controller.handleKeyDown(baseEvent({ key: 'v' }))

    expect(heights.goTo).toHaveBeenCalledOnce()
    expect(heights.goTo).toHaveBeenCalledWith('general')
  })

  it('any modifier held resolves to null — zero store updates, zero camera calls', () => {
    const { store, heights, controller } = setup('b')
    const before = store.get().selection.selectedId

    controller.handleKeyDown(baseEvent({ key: 'h', ctrlKey: true }))
    controller.handleKeyDown(baseEvent({ key: 'f', metaKey: true }))
    controller.handleKeyDown(baseEvent({ key: 'v', shiftKey: true }))
    controller.handleKeyDown(baseEvent({ key: 'l', altKey: true }))

    expect(store.get().selection.selectedId).toBe(before)
    expect(heights.goTo).not.toHaveBeenCalled()
  })

  it('an unmapped key is a no-op', () => {
    const { store, heights, controller } = setup('b')
    const before = store.get().selection.selectedId

    controller.handleKeyDown(baseEvent({ key: 'q' }))

    expect(store.get().selection.selectedId).toBe(before)
    expect(heights.goTo).not.toHaveBeenCalled()
  })

  it('ignores keys while focus is inside a text-entry target (isTextEntryTarget guard)', () => {
    const { store, heights, controller } = setup('b')
    const before = store.get().selection.selectedId

    controller.handleKeyDown(
      baseEvent({ key: 'h', target: { tagName: 'INPUT', isContentEditable: false } })
    )
    controller.handleKeyDown(
      baseEvent({ key: 'f', target: { tagName: 'DIV', isContentEditable: true } })
    )

    expect(store.get().selection.selectedId).toBe(before)
    expect(heights.goTo).not.toHaveBeenCalled()
  })

  it('still acts on a non-text DOM target', () => {
    const { store, controller } = setup('b')

    controller.handleKeyDown(
      baseEvent({ key: 'h', target: { tagName: 'DIV', isContentEditable: false } })
    )

    expect(store.get().selection.selectedId).toBe('root')
  })

  it('a selection move notifies heights.onSelectionChanged with the new id — no camera math here', () => {
    const { store, heights, controller } = setup('b')

    controller.handleKeyDown(baseEvent({ key: 'j' })) // b -> c

    expect(store.get().selection.selectedId).toBe('c')
    expect(heights.onSelectionChanged).toHaveBeenCalledWith('c')
  })

  it('a move that clamps in place (no id change) still notifies heights.onSelectionChanged', () => {
    const { heights, controller } = setup('c') // 'c' is the last sibling — j clamps to itself

    controller.handleKeyDown(baseEvent({ key: 'j' }))

    expect(heights.onSelectionChanged).toHaveBeenCalledWith('c')
  })

  it('attach()/detach() are a thin DOM wrapper — smoke-tested via a fake EventTarget', () => {
    const { controller } = setup('b')
    const fakeTarget = { addEventListener: vi.fn(), removeEventListener: vi.fn() }

    const detach = controller.attach(fakeTarget)

    expect(fakeTarget.addEventListener).toHaveBeenCalledTimes(1)
    const [eventName, handler] = fakeTarget.addEventListener.mock.calls[0]!
    expect(eventName).toBe('keydown')
    expect(typeof handler).toBe('function')

    detach()

    expect(fakeTarget.removeEventListener).toHaveBeenCalledTimes(1)
    const [detachEventName, detachHandler] = fakeTarget.removeEventListener.mock.calls[0]!
    expect(detachEventName).toBe('keydown')
    expect(detachHandler).toBe(handler)
  })

  it('never imports or constructs THREE objects — the selection ring stays the only indicator', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./keyboard-controller.ts', import.meta.url)),
      'utf8'
    )
    expect(source).not.toMatch(/from ['"]three['"]/)
    expect(source).not.toMatch(/new THREE\.(Mesh|Line)/)
  })

  describe('terminal command arbitration (design Area 8)', () => {
    it('t opens a terminal for the selected node and focuses the panel', () => {
      const { store, terminal, controller } = setup('a')
      const handled = controller.handleKeyDown(baseEvent({ key: 't' }))
      expect(handled).toBe(true)
      expect(store.get().terminals.activePanel).toMatchObject({ nodeId: 'a', placement: 'scene' })
      expect(terminal.focusActivePanel).toHaveBeenCalledOnce()
    })

    it('t with no node selected is a no-op', () => {
      const { store, terminal, controller } = setup(null)
      controller.handleKeyDown(baseEvent({ key: 't' }))
      expect(store.get().terminals.activePanel).toBeNull()
      expect(terminal.focusActivePanel).not.toHaveBeenCalled()
    })

    it('t on an already-open node just refocuses it instead of opening a second session', () => {
      const { store, controller } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 't' }))
      store.dispatchTerminal({ type: 'set-focused', focused: false })
      controller.handleKeyDown(baseEvent({ key: 't' }))
      expect(store.get().terminals.byNode.get('a')).toHaveLength(1)
      expect(store.get().terminals.activePanel?.focused).toBe(true)
    })

    it('shift+t always opens a brand-new terminal tab, even on an already-open node (v3-3)', () => {
      const { store, terminal, controller } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 't' }))
      const handled = controller.handleKeyDown(baseEvent({ key: 'T', shiftKey: true }))
      expect(handled).toBe(true)
      expect(store.get().terminals.byNode.get('a')).toHaveLength(2)
      expect(terminal.focusActivePanel).toHaveBeenCalledTimes(2)
    })

    it('shift+t marks the new session forceNew:true so mount bypasses attach-to-existing', () => {
      const { store, controller } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 'T', shiftKey: true }))
      const streamId = store.get().terminals.byNode.get('a')?.[0]
      expect(store.get().terminals.sessions.get(streamId!)?.forceNew).toBe(true)
    })

    it('bare t still just carries forceNew:false through the dispatch', () => {
      const { store, controller } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 't' }))
      const streamId = store.get().terminals.byNode.get('a')?.[0]
      expect(store.get().terminals.sessions.get(streamId!)?.forceNew).toBe(false)
    })

    it('p toggles placement scene -> hud -> scene', () => {
      const { store, controller } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 't' }))
      expect(store.get().terminals.activePanel?.placement).toBe('scene')
      controller.handleKeyDown(baseEvent({ key: 'p' }))
      expect(store.get().terminals.activePanel?.placement).toBe('hud')
      controller.handleKeyDown(baseEvent({ key: 'p' }))
      expect(store.get().terminals.activePanel?.placement).toBe('scene')
    })

    it('p with no terminal open is a no-op', () => {
      const { store, controller } = setup('a')
      const handled = controller.handleKeyDown(baseEvent({ key: 'p' }))
      expect(handled).toBe(false)
      expect(store.get().terminals.activePanel).toBeNull()
    })

    it('Tab cycles tabs on the active node and is consumed (default browser traversal suppressed)', () => {
      const { store, controller } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 't' }))
      store.dispatchTerminal({ type: 'open-terminal-for-node', nodeId: 'a' })
      const handled = controller.handleKeyDown(baseEvent({ key: 'Tab' }))
      expect(handled).toBe(true)
      expect(store.get().terminals.activePanel?.sessionIndex).toBe(0)
    })

    it('Escape closes the active terminal via the terminal command port', () => {
      const { terminal, controller } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 't' }))
      const handled = controller.handleKeyDown(baseEvent({ key: 'Escape' }))
      expect(handled).toBe(true)
      expect(terminal.closeActiveSession).toHaveBeenCalledOnce()
    })

    it('Escape with no terminal open is a graph-nav no-op, never reaches the terminal port', () => {
      const { terminal, controller } = setup('a')
      const handled = controller.handleKeyDown(baseEvent({ key: 'Escape' }))
      expect(handled).toBe(false)
      expect(terminal.closeActiveSession).not.toHaveBeenCalled()
    })

    it('spawn-close beats terminal-close: Escape with both open cancels spawn, leaves the terminal untouched (SPAWN-005)', () => {
      const { store, terminal, controller } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 't' })) // terminal open
      store.dispatchSpawn({ type: 'open-for-node', nodeId: 'a' }) // spawn radial open

      const handled = controller.handleKeyDown(baseEvent({ key: 'Escape' }))

      expect(handled).toBe(true)
      expect(store.get().spawnMenu.view).toBe('closed')
      expect(terminal.closeActiveSession).not.toHaveBeenCalled()
      expect(store.get().terminals.activePanel).not.toBeNull()
    })

    it('once spawn is closed, Escape still routes to terminal-close as before', () => {
      const { store, terminal, controller } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 't' }))
      store.dispatchSpawn({ type: 'open-for-node', nodeId: 'a' })
      controller.handleKeyDown(baseEvent({ key: 'Escape' })) // closes spawn only

      const handled = controller.handleKeyDown(baseEvent({ key: 'Escape' }))

      expect(handled).toBe(true)
      expect(terminal.closeActiveSession).toHaveBeenCalledOnce()
    })

    it('a focused text-entry target (xterm textarea) suppresses hjkl AND the terminal commands alike', () => {
      const { store, terminal, controller } = setup('a')
      const textarea = { tagName: 'TEXTAREA', isContentEditable: false }
      controller.handleKeyDown(baseEvent({ key: 'h', target: textarea }))
      controller.handleKeyDown(baseEvent({ key: 't', target: textarea }))
      controller.handleKeyDown(baseEvent({ key: 'Escape', target: textarea }))
      expect(store.get().selection.selectedId).toBe('a')
      expect(store.get().terminals.activePanel).toBeNull()
      expect(terminal.focusActivePanel).not.toHaveBeenCalled()
      expect(terminal.closeActiveSession).not.toHaveBeenCalled()
    })
  })

  describe('spawn command arbitration (SPAWN-002/005)', () => {
    it('s with a node selected and spawn closed opens the radial anchored to it', () => {
      const { store, controller } = setup('a')
      const handled = controller.handleKeyDown(baseEvent({ key: 's' }))
      expect(handled).toBe(true)
      expect(store.get().spawnMenu).toMatchObject({ view: 'radial', nodeId: 'a' })
    })

    it('s with no node selected and spawn closed opens the form directly (rootless)', () => {
      const { store, controller } = setup(null)
      const handled = controller.handleKeyDown(baseEvent({ key: 's' }))
      expect(handled).toBe(true)
      expect(store.get().spawnMenu).toMatchObject({ view: 'form', parentId: null })
    })

    it('s while the radial is open chooses the spawn chip, transitioning radial -> form', () => {
      const { store, controller } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 's' }))
      const handled = controller.handleKeyDown(baseEvent({ key: 's' }))
      expect(handled).toBe(true)
      expect(store.get().spawnMenu).toMatchObject({ view: 'form', parentId: 'a' })
    })

    it('Shift+F from the open radial opens the fan-out form and closes the radial', () => {
      const { store, controller } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 's' }))
      const handled = controller.handleKeyDown(baseEvent({ key: 'F', shiftKey: true }))
      expect(handled).toBe(true)
      expect(store.get().spawnMenu.view).toBe('closed')
      expect(store.get().fanOut.view).not.toBe('closed')
    })

    it('s while the form is already open is a no-op', () => {
      const { store, controller } = setup(null)
      controller.handleKeyDown(baseEvent({ key: 's' }))
      const handled = controller.handleKeyDown(baseEvent({ key: 's' }))
      expect(handled).toBe(false)
      expect(store.get().spawnMenu.view).toBe('form')
    })

    it('hjkl while the radial is open is a handled no-op — it never moves the graph selection', () => {
      const { store, controller } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 's' }))
      const handled = controller.handleKeyDown(baseEvent({ key: 'j' }))
      expect(handled).toBe(true)
      expect(store.get().selection.selectedId).toBe('a')
      expect(store.get().spawnMenu.view).toBe('radial')
    })

    it("typing 's' into a focused form field never dispatches open-spawn (isTextEntryTarget guard)", () => {
      const { store, controller } = setup('a')
      const input = { tagName: 'INPUT', isContentEditable: false }
      const handled = controller.handleKeyDown(baseEvent({ key: 's', target: input }))
      expect(handled).toBe(false)
      expect(store.get().spawnMenu.view).toBe('closed')
    })
  })

  describe('⌘P/Ctrl+P projects chord and Tab/Escape precedence (PROJ-005/008)', () => {
    it('meta+p on Mac opens the project selector', () => {
      const { store, controller } = setup('a', MAC)
      const handled = controller.handleKeyDown(baseEvent({ key: 'p', metaKey: true }))
      expect(handled).toBe(true)
      expect(store.get().projectSelector.view).toBe('open')
    })

    it('ctrl+p on Linux/Windows opens the project selector', () => {
      const { store, controller } = setup('a', LINUX)
      const handled = controller.handleKeyDown(baseEvent({ key: 'p', ctrlKey: true }))
      expect(handled).toBe(true)
      expect(store.get().projectSelector.view).toBe('open')
    })

    it('the wrong-platform chord stays gated and does not open the selector', () => {
      const { store, controller } = setup('a', MAC)
      const handled = controller.handleKeyDown(baseEvent({ key: 'p', ctrlKey: true }))
      expect(handled).toBe(false)
      expect(store.get().projectSelector.view).toBe('closed')
    })

    it('the ⌘P/Ctrl+P chord opens the selector even while a terminal (text-entry target) is focused', () => {
      const { store, controller } = setup('a', LINUX)
      const textarea = { tagName: 'TEXTAREA', isContentEditable: false }
      const handled = controller.handleKeyDown(
        baseEvent({ key: 'p', ctrlKey: true, target: textarea })
      )
      expect(handled).toBe(true)
      expect(store.get().projectSelector.view).toBe('open')
    })

    it('bare p still pins the terminal, chord unaffected', () => {
      const { store, controller } = setup('a', LINUX)
      controller.handleKeyDown(baseEvent({ key: 't' }))
      const handled = controller.handleKeyDown(baseEvent({ key: 'p' }))
      expect(handled).toBe(true)
      expect(store.get().terminals.activePanel?.placement).toBe('hud')
      expect(store.get().projectSelector.view).toBe('closed')
    })

    it('Tab with the selector open is consumed as a no-op — never reaches terminal or island cycling', () => {
      const { store, heights, controller } = setupWithRepos()
      controller.handleKeyDown(baseEvent({ key: 'p', ctrlKey: true })) // open selector
      const activeBefore = store.get().repos.activeRepoId

      const handled = controller.handleKeyDown(baseEvent({ key: 'Tab' }))

      expect(handled).toBe(true)
      expect(store.get().repos.activeRepoId).toBe(activeBefore)
      expect(heights.reanchorIsland).not.toHaveBeenCalled()
    })

    it('Tab with no terminal open cycles to the next island, dispatching set-active and reanchoring on it', () => {
      const { store, heights, controller } = setupWithRepos()
      expect(store.get().repos.activeRepoId).toBe('r1') // reconciled default

      const handled = controller.handleKeyDown(baseEvent({ key: 'Tab' }))

      expect(handled).toBe(true)
      expect(store.get().repos.activeRepoId).toBe('r2')
      expect(heights.reanchorIsland).toHaveBeenCalledWith('r2')
    })

    it('Tab island-cycle wraps back to the first repo and is a no-op with zero repos', () => {
      const { store, controller } = setupWithRepos()
      controller.handleKeyDown(baseEvent({ key: 'Tab' })) // r1 -> r2
      controller.handleKeyDown(baseEvent({ key: 'Tab' })) // r2 -> wraps to r1
      expect(store.get().repos.activeRepoId).toBe('r1')

      store.dispatchRepos({ type: 'set-list', list: [] })
      const handled = controller.handleKeyDown(baseEvent({ key: 'Tab' }))
      expect(handled).toBe(false)
    })

    it('Tab with a terminal focused still takes precedence over island cycling', () => {
      const { store, controller } = setupWithRepos()
      store.update({
        selection: { selectedId: 'x1' },
        connection: { state: 'connected', runtimeId: 'r' }
      })
      controller.handleKeyDown(baseEvent({ key: 't' }))
      const activeBefore = store.get().repos.activeRepoId

      const handled = controller.handleKeyDown(baseEvent({ key: 'Tab' }))

      expect(handled).toBe(true)
      expect(store.get().terminals.activePanel?.sessionIndex).toBe(0)
      expect(store.get().repos.activeRepoId).toBe(activeBefore)
    })

    it('Escape closes only the selector, leaving an open terminal and spawn menu untouched', () => {
      const { store, terminal, controller } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 't' }))
      store.dispatchSpawn({ type: 'open-for-node', nodeId: 'a' })
      store.dispatchProjectSelector({ type: 'open' })

      const handled = controller.handleKeyDown(baseEvent({ key: 'Escape' }))

      expect(handled).toBe(true)
      expect(store.get().projectSelector.view).toBe('closed')
      expect(store.get().spawnMenu.view).not.toBe('closed')
      expect(terminal.closeActiveSession).not.toHaveBeenCalled()
    })

    it.each(['p', 'k'] as const)(
      'attach() calls preventDefault on the ⌘%s/Ctrl+%s chord (isBrowserChord, suppresses the browser dialog)',
      (key) => {
        // No DOM in this unit-test environment — `attach`'s `instanceof HTMLElement` check needs a
        // real constructor to compare against, even though `target` itself stays null below.
        vi.stubGlobal('HTMLElement', function HTMLElementStub() {})
        try {
          const { controller } = setup('a', LINUX)
          const fakeTarget = { addEventListener: vi.fn(), removeEventListener: vi.fn() }
          controller.attach(fakeTarget)
          const [, handler] = fakeTarget.addEventListener.mock.calls[0]!

          const preventDefault = vi.fn()
          handler({
            key,
            ctrlKey: true,
            metaKey: false,
            altKey: false,
            shiftKey: false,
            target: null,
            preventDefault
          } as unknown as KeyboardEvent)

          expect(preventDefault).toHaveBeenCalledOnce()
        } finally {
          vi.unstubAllGlobals()
        }
      }
    )
  })

  describe('diff rail j/k', () => {
    const files = ['a.ts', 'b.ts', 'c.ts'].map((path) => ({
      path,
      status: 'modified',
      added: 1,
      removed: 0
    }))

    function openDiff(selectedPath: string | null) {
      const ctx = setup('a')
      ctx.store.dispatchDiffView({ type: 'open', nodeId: 'a', baseRef: 'main' })
      ctx.store.dispatchDiffView({
        type: 'rail-loaded',
        compare: { headOid: 'h', mergeBase: 'm' },
        files
      })
      if (selectedPath !== null) ctx.store.dispatchDiffView({ type: 'select', path: selectedPath })
      return ctx
    }

    it('j selects the next file through the diff port and k the previous one', () => {
      const { controller, diff } = openDiff('b.ts')
      expect(controller.handleKeyDown(baseEvent({ key: 'j' }))).toBe(true)
      expect(diff.select).toHaveBeenLastCalledWith('c.ts')
      controller.handleKeyDown(baseEvent({ key: 'k' }))
      expect(diff.select).toHaveBeenLastCalledWith('a.ts')
    })

    it('j with nothing selected enters at the first file', () => {
      const { controller, diff } = openDiff(null)
      controller.handleKeyDown(baseEvent({ key: 'j' }))
      expect(diff.select).toHaveBeenCalledWith('a.ts')
    })

    it('does not move the graph selection while diff is open', () => {
      const { controller, store } = openDiff('a.ts')
      controller.handleKeyDown(baseEvent({ key: 'j' }))
      expect(store.get().selection.selectedId).toBe('a')
    })

    it('is a handled no-op with an empty rail', () => {
      const { controller, store, diff } = setup('a')
      store.dispatchDiffView({ type: 'open', nodeId: 'a', baseRef: 'main' })
      expect(controller.handleKeyDown(baseEvent({ key: 'j' }))).toBe(true)
      expect(diff.select).not.toHaveBeenCalled()
    })

    it('never touches the diff port when diff is closed', () => {
      const { controller, diff } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 'j' }))
      expect(diff.select).not.toHaveBeenCalled()
    })
  })

  describe('x/d switch between system and diff', () => {
    it('x with diff open closes diff and opens system on the selected node', () => {
      const { controller, store } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 'd' }))
      expect(store.get().diffView.view).toBe('open')

      expect(controller.handleKeyDown(baseEvent({ key: 'x' }))).toBe(true)

      expect(store.get().diffView.view).toBe('closed')
      expect(store.get().systemView).toMatchObject({ view: 'open', focusedNodeId: 'a' })
    })

    it('d with system open closes system and opens diff on the selected node', () => {
      const { controller, store } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 'x' }))

      expect(controller.handleKeyDown(baseEvent({ key: 'd' }))).toBe(true)

      expect(store.get().systemView.view).toBe('closed')
      expect(store.get().diffView).toMatchObject({ view: 'open', focusedNodeId: 'a' })
    })

    it('the key of the mode already open is a handled no-op', () => {
      const { controller, store } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 'd' }))
      const before = store.get().diffView

      expect(controller.handleKeyDown(baseEvent({ key: 'd' }))).toBe(true)

      expect(store.get().diffView).toBe(before)
      expect(store.get().systemView.view).toBe('closed')
    })

    it('never opens both modes at once', () => {
      const { controller, store } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 'd' }))
      controller.handleKeyDown(baseEvent({ key: 'x' }))
      controller.handleKeyDown(baseEvent({ key: 'd' }))
      const { systemView, diffView } = store.get()
      expect([systemView.view, diffView.view].filter((v) => v === 'open')).toHaveLength(1)
    })
  })

  describe('t without a host (demo mode)', () => {
    it('does not open a terminal panel it could never mount', () => {
      const { store, terminal, controller } = setup('a')
      store.update({ connection: { state: 'down', reason: 'not connected' } })
      expect(controller.handleKeyDown(baseEvent({ key: 't' }))).toBe(false)
      expect(store.get().terminals.activePanel).toBeNull()
      expect(terminal.focusActivePanel).not.toHaveBeenCalled()
    })
  })

  describe('attach() form-opening keys', () => {
    function press(
      key: string,
      shiftKey: boolean,
      target: { tagName: string; isContentEditable: boolean } | null
    ) {
      vi.stubGlobal('HTMLElement', function HTMLElementStub(this: unknown) {
        Object.assign(this as object, target)
      })
      try {
        const { controller } = setup('a', LINUX)
        const fakeTarget = { addEventListener: vi.fn(), removeEventListener: vi.fn() }
        controller.attach(fakeTarget)
        const [, handler] = fakeTarget.addEventListener.mock.calls[0]!
        const preventDefault = vi.fn()
        const domTarget = target
          ? new (globalThis.HTMLElement as never as new () => object)()
          : null
        handler({
          key,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey,
          target: domTarget,
          preventDefault
        } as unknown as KeyboardEvent)
        return preventDefault
      } finally {
        vi.unstubAllGlobals()
      }
    }

    it('preventDefaults the handled s that opens the spawn form (no leak into the focused field)', () => {
      expect(press('s', false, null)).toHaveBeenCalledOnce()
    })

    it('preventDefaults the handled shift+f that opens the fan-out form', () => {
      expect(press('F', true, null)).toHaveBeenCalledOnce()
    })

    it('preventDefaults the handled o that opens the file picker (no leak into the query)', () => {
      expect(press('o', false, null)).toHaveBeenCalledOnce()
    })

    it.each([
      ['t', false],
      ['T', true]
    ])(
      'preventDefaults the handled %s that focuses the terminal (no leak into the PTY)',
      (key, shift) => {
        expect(press(key, shift, null)).toHaveBeenCalledOnce()
      }
    )

    it('never preventDefaults an s typed into a text field (not handled)', () => {
      expect(
        press('s', false, { tagName: 'INPUT', isContentEditable: false })
      ).not.toHaveBeenCalled()
    })

    it('never preventDefaults an unhandled key', () => {
      expect(press('z', false, null)).not.toHaveBeenCalled()
    })
  })

  describe('shift+f fan-out chord', () => {
    it('dispatches the fan-out open action for the selected node', () => {
      const { store, controller } = setup('a')
      const handled = controller.handleKeyDown(baseEvent({ key: 'f', shiftKey: true }))
      expect(handled).toBe(true)
      expect(store.get().fanOut).toMatchObject({ view: 'form', parentId: 'a' })
    })

    it('is a no-op returning false with nothing selected', () => {
      const { store, controller } = setup(null)
      const handled = controller.handleKeyDown(baseEvent({ key: 'f', shiftKey: true }))
      expect(handled).toBe(false)
      expect(store.get().fanOut.view).toBe('closed')
    })
  })

  describe('⌘K/Ctrl+K command palette chord and Tab/Escape precedence', () => {
    it('meta+k on Mac opens the palette', () => {
      const { store, controller } = setup('a', MAC)
      const handled = controller.handleKeyDown(baseEvent({ key: 'k', metaKey: true }))
      expect(handled).toBe(true)
      expect(store.get().commandPalette.view).toBe('open')
    })

    it('ctrl+k on Linux/Windows opens the palette', () => {
      const { store, controller } = setup('a', LINUX)
      const handled = controller.handleKeyDown(baseEvent({ key: 'k', ctrlKey: true }))
      expect(handled).toBe(true)
      expect(store.get().commandPalette.view).toBe('open')
    })

    it('the wrong-platform chord stays gated and does not open the palette', () => {
      const { store, controller } = setup('a', MAC)
      const handled = controller.handleKeyDown(baseEvent({ key: 'k', ctrlKey: true }))
      expect(handled).toBe(false)
      expect(store.get().commandPalette.view).toBe('closed')
    })

    it('opens the palette even while a terminal (text-entry target) is focused', () => {
      const { store, controller } = setup('a', LINUX)
      const textarea = { tagName: 'TEXTAREA', isContentEditable: false }
      const handled = controller.handleKeyDown(
        baseEvent({ key: 'k', ctrlKey: true, target: textarea })
      )
      expect(handled).toBe(true)
      expect(store.get().commandPalette.view).toBe('open')
    })

    it('bare k still moves to prev-sibling, chord unaffected', () => {
      const { store, controller } = setup('c', LINUX)
      const handled = controller.handleKeyDown(baseEvent({ key: 'k' }))
      expect(handled).toBe(true)
      expect(store.get().commandPalette.view).toBe('closed')
    })

    it('opening the palette also closes the project selector and cancels an open spawn menu', () => {
      const { store, controller } = setup('a', LINUX)
      store.dispatchProjectSelector({ type: 'open' })
      store.dispatchSpawn({ type: 'open-for-node', nodeId: 'a' })

      const handled = controller.handleKeyDown(baseEvent({ key: 'k', ctrlKey: true }))

      expect(handled).toBe(true)
      expect(store.get().projectSelector.view).toBe('closed')
      expect(store.get().spawnMenu.view).toBe('closed')
      expect(store.get().commandPalette.view).toBe('open')
    })

    it('Escape closes only the palette, leaving an open selector/spawn/terminal untouched (palette wins precedence)', () => {
      const { store, terminal, controller } = setup('a', LINUX)
      controller.handleKeyDown(baseEvent({ key: 't' }))
      store.dispatchSpawn({ type: 'open-for-node', nodeId: 'a' })
      store.dispatchProjectSelector({ type: 'open' })
      store.dispatchCommandPalette({ type: 'open' })

      const handled = controller.handleKeyDown(baseEvent({ key: 'Escape' }))

      expect(handled).toBe(true)
      expect(store.get().commandPalette.view).toBe('closed')
      expect(store.get().projectSelector.view).not.toBe('closed')
      expect(store.get().spawnMenu.view).not.toBe('closed')
      expect(terminal.closeActiveSession).not.toHaveBeenCalled()
    })

    it('Tab with the palette open is consumed as a no-op — never reaches selector/terminal/island cycling', () => {
      const { store, heights, controller } = setupWithRepos()
      store.dispatchCommandPalette({ type: 'open' })
      const activeBefore = store.get().repos.activeRepoId

      const handled = controller.handleKeyDown(baseEvent({ key: 'Tab' }))

      expect(handled).toBe(true)
      expect(store.get().repos.activeRepoId).toBe(activeBefore)
      expect(heights.reanchorIsland).not.toHaveBeenCalled()
    })
  })

  describe('x/g sistema en vivo (system view) precedence', () => {
    it('x dispatches system-view open for the selected node', () => {
      const { store, controller } = setup('a')
      const handled = controller.handleKeyDown(baseEvent({ key: 'x' }))
      expect(handled).toBe(true)
      expect(store.get().systemView).toMatchObject({ view: 'open', focusedNodeId: 'a' })
    })

    it('x with no node selected is a no-op', () => {
      const { store, controller } = setup(null)
      const handled = controller.handleKeyDown(baseEvent({ key: 'x' }))
      expect(handled).toBe(false)
      expect(store.get().systemView.view).toBe('closed')
    })

    it('g closes an open system view', () => {
      const { store, controller } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 'x' }))
      const handled = controller.handleKeyDown(baseEvent({ key: 'g' }))
      expect(handled).toBe(true)
      expect(store.get().systemView.view).toBe('closed')
    })

    it('g with the system view already closed is a no-op', () => {
      const { store, controller } = setup('a')
      const handled = controller.handleKeyDown(baseEvent({ key: 'g' }))
      expect(handled).toBe(false)
      expect(store.get().systemView.view).toBe('closed')
    })

    it('while open, suppresses graph-nav (h/j/k/l), terminal (t), spawn (s) and re-pressing x — all handled no-ops', () => {
      const { store, terminal, controller } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 'x' }))
      const selectedBefore = store.get().selection.selectedId

      expect(controller.handleKeyDown(baseEvent({ key: 'h' }))).toBe(true)
      expect(controller.handleKeyDown(baseEvent({ key: 't' }))).toBe(true)
      expect(controller.handleKeyDown(baseEvent({ key: 's' }))).toBe(true)
      expect(controller.handleKeyDown(baseEvent({ key: 'x' }))).toBe(true)

      expect(store.get().selection.selectedId).toBe(selectedBefore)
      expect(store.get().terminals.activePanel).toBeNull()
      expect(store.get().spawnMenu.view).toBe('closed')
      expect(terminal.focusActivePanel).not.toHaveBeenCalled()
      expect(store.get().systemView.view).toBe('open') // still open, untouched by the no-ops
    })

    it('⌘K/Ctrl+K and ⌘P/Ctrl+P still work while the system view is open', () => {
      const { store, controller } = setup('a', MAC)
      controller.handleKeyDown(baseEvent({ key: 'x' }))

      expect(controller.handleKeyDown(baseEvent({ key: 'k', metaKey: true }))).toBe(true)
      expect(store.get().commandPalette.view).toBe('open')

      expect(controller.handleKeyDown(baseEvent({ key: 'p', metaKey: true }))).toBe(true)
      expect(store.get().projectSelector.view).toBe('open')
    })

    it('Escape precedence: palette > selector > spawn > system > diff > terminal', () => {
      const { store, terminal, controller } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 't' })) // terminal open
      controller.handleKeyDown(baseEvent({ key: 'x' })) // system open (suppresses further hjkl/t/s)
      store.dispatchSpawn({ type: 'open-for-node', nodeId: 'a' })
      store.dispatchProjectSelector({ type: 'open' })
      store.dispatchCommandPalette({ type: 'open' })
      store.dispatchSystemView({ type: 'close' }) // reopen the ladder's next rung: diff
      store.dispatchDiffView({ type: 'open', nodeId: 'a', baseRef: 'main' })

      expect(controller.handleKeyDown(baseEvent({ key: 'Escape' }))).toBe(true) // closes palette
      expect(store.get().commandPalette.view).toBe('closed')
      expect(store.get().diffView.view).toBe('open')

      expect(controller.handleKeyDown(baseEvent({ key: 'Escape' }))).toBe(true) // closes selector
      expect(store.get().projectSelector.view).toBe('closed')
      expect(store.get().diffView.view).toBe('open')

      expect(controller.handleKeyDown(baseEvent({ key: 'Escape' }))).toBe(true) // closes spawn
      expect(store.get().spawnMenu.view).toBe('closed')
      expect(store.get().diffView.view).toBe('open')

      expect(controller.handleKeyDown(baseEvent({ key: 'Escape' }))).toBe(true) // closes diff (system already closed)
      expect(store.get().diffView.view).toBe('closed')
      expect(terminal.closeActiveSession).not.toHaveBeenCalled()

      expect(controller.handleKeyDown(baseEvent({ key: 'Escape' }))).toBe(true) // finally terminal
      expect(terminal.closeActiveSession).toHaveBeenCalledOnce()
    })

    it('opening diff after system is already open closes system at the store chokepoint (scene-store.ts mutual exclusion) — a single Escape then closes diff', () => {
      const { store, controller } = setup('a')
      store.dispatchSystemView({ type: 'open', nodeId: 'a' })
      store.dispatchDiffView({ type: 'open', nodeId: 'a', baseRef: 'main' })

      // scene-store.ts's dispatchDiffView already closed system — both open is unreachable now.
      expect(store.get().systemView.view).toBe('closed')
      expect(store.get().diffView.view).toBe('open')

      expect(controller.handleKeyDown(baseEvent({ key: 'Escape' }))).toBe(true)
      expect(store.get().diffView.view).toBe('closed')
    })
  })

  describe('d/g diff view precedence', () => {
    it('d dispatches diff-view open for the selected node', () => {
      const { store, controller } = setup('a')
      const handled = controller.handleKeyDown(baseEvent({ key: 'd' }))
      expect(handled).toBe(true)
      expect(store.get().diffView).toMatchObject({ view: 'open', focusedNodeId: 'a' })
    })

    it('d with no node selected is a no-op', () => {
      const { store, controller } = setup(null)
      const handled = controller.handleKeyDown(baseEvent({ key: 'd' }))
      expect(handled).toBe(false)
      expect(store.get().diffView.view).toBe('closed')
    })

    it('g closes an open diff view', () => {
      const { store, controller } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 'd' }))
      const handled = controller.handleKeyDown(baseEvent({ key: 'g' }))
      expect(handled).toBe(true)
      expect(store.get().diffView.view).toBe('closed')
    })

    it('g with the diff view already closed is a no-op', () => {
      const { store, controller } = setup('a')
      const handled = controller.handleKeyDown(baseEvent({ key: 'g' }))
      expect(handled).toBe(false)
      expect(store.get().diffView.view).toBe('closed')
    })

    it('while open, suppresses graph-nav (h/j/k/l), terminal (t), spawn (s), open-system (x) and re-pressing d — all handled no-ops', () => {
      const { store, terminal, controller } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 'd' }))
      const selectedBefore = store.get().selection.selectedId

      expect(controller.handleKeyDown(baseEvent({ key: 'h' }))).toBe(true)
      expect(controller.handleKeyDown(baseEvent({ key: 't' }))).toBe(true)
      expect(controller.handleKeyDown(baseEvent({ key: 's' }))).toBe(true)
      expect(controller.handleKeyDown(baseEvent({ key: 'x' }))).toBe(true)
      expect(controller.handleKeyDown(baseEvent({ key: 'd' }))).toBe(true)

      expect(store.get().selection.selectedId).toBe(selectedBefore)
      expect(store.get().terminals.activePanel).toBeNull()
      expect(store.get().spawnMenu.view).toBe('closed')
      expect(store.get().systemView.view).toBe('closed')
      expect(terminal.focusActivePanel).not.toHaveBeenCalled()
      expect(store.get().diffView.view).toBe('open') // still open, untouched by the no-ops
    })

    it('⌘K/Ctrl+K and ⌘P/Ctrl+P still work while the diff view is open', () => {
      const { store, controller } = setup('a', MAC)
      controller.handleKeyDown(baseEvent({ key: 'd' }))

      expect(controller.handleKeyDown(baseEvent({ key: 'k', metaKey: true }))).toBe(true)
      expect(store.get().commandPalette.view).toBe('open')

      expect(controller.handleKeyDown(baseEvent({ key: 'p', metaKey: true }))).toBe(true)
      expect(store.get().projectSelector.view).toBe('open')
    })
  })

  describe('c/g compare view precedence — anchors on the running camada, not selectedId', () => {
    it('c dispatches compareView open with the litter, parent dropped', () => {
      const { store, controller } = setup(null)
      withRunningCamada(store, 'root', ['child-1', 'child-2'])

      const handled = controller.handleKeyDown(baseEvent({ key: 'c' }))

      expect(handled).toBe(true)
      expect(store.get().compareView).toMatchObject({
        view: 'open',
        members: ['child-1', 'child-2']
      })
    })

    it('c ignores the current selection entirely — the running camada is the anchor', () => {
      const { store, controller } = setup('b') // selectedId 'b' is unrelated to the camada below
      withRunningCamada(store, 'root', ['child-1'])

      controller.handleKeyDown(baseEvent({ key: 'c' }))

      expect(store.get().compareView).toMatchObject({ view: 'open', members: ['child-1'] })
    })

    it('c with no camada (fanOut closed) is a no-op', () => {
      const { store, controller } = setup('a')
      const handled = controller.handleKeyDown(baseEvent({ key: 'c' }))
      expect(handled).toBe(false)
      expect(store.get().compareView.view).toBe('closed')
    })

    it('c with a running camada but no created children yet (empty litter) is a no-op', () => {
      const { store, controller } = setup('a')
      store.dispatchFanOut({ type: 'open-for-node', nodeId: 'root' })
      store.dispatchFanOut({ type: 'set-repo-selector', repoSelector: 'id:repo-a' })
      store.dispatchFanOut({ type: 'submit', mutationIds: ['m0', 'm1'] }) // still pending, no worktreeId yet

      const handled = controller.handleKeyDown(baseEvent({ key: 'c' }))

      expect(handled).toBe(false)
      expect(store.get().compareView.view).toBe('closed')
    })

    describe('after a reload (fan-out slice gone)', () => {
      const withNotice = (rememberedLitter: readonly string[]) => {
        const notice = vi.fn()
        const store = createSceneStore()
        store.update({ graph: buildFanGraph(), selection: { selectedId: 'a' }, rememberedLitter })
        const controller = createKeyboardController({
          store,
          heights: fakeHeights(),
          terminal: fakeTerminalCommandPort(),
          diff: { select: vi.fn() },
          worktreeDelete: fakeWorktreeDelete(),
          fileWorkspace: {
            openPicker: vi.fn(),
            openFile: vi.fn(),
            isOpen: () => false,
            requestClose: () => false
          },
          platform: LINUX,
          notice
        })
        return { store, controller, notice }
      }

      it('c compares the remembered litter', () => {
        const { store, controller, notice } = withNotice(['a', 'b'])
        expect(controller.handleKeyDown(baseEvent({ key: 'c' }))).toBe(true)
        expect(store.get().compareView).toMatchObject({ view: 'open', members: ['a', 'b'] })
        expect(notice).not.toHaveBeenCalled()
      })

      it('c shows a hint when there is no litter to restore', () => {
        const { store, controller, notice } = withNotice(['gone'])
        expect(controller.handleKeyDown(baseEvent({ key: 'c' }))).toBe(true)
        expect(store.get().compareView.view).toBe('closed')
        expect(notice).toHaveBeenCalledOnce()
      })
    })

    it('g closes an open compareView', () => {
      const { store, controller } = setup(null)
      withRunningCamada(store, 'root', ['child-1'])
      controller.handleKeyDown(baseEvent({ key: 'c' }))

      const handled = controller.handleKeyDown(baseEvent({ key: 'g' }))

      expect(handled).toBe(true)
      expect(store.get().compareView.view).toBe('closed')
    })

    it('while open, suppresses graph-nav (h/j/k/l), terminal (t), spawn (s), open-system (x), open-diff (d) and re-pressing c — all handled no-ops', () => {
      const { store, terminal, controller } = setup('a')
      withRunningCamada(store, 'root', ['child-1'])
      controller.handleKeyDown(baseEvent({ key: 'c' }))
      const selectedBefore = store.get().selection.selectedId

      expect(controller.handleKeyDown(baseEvent({ key: 'h' }))).toBe(true)
      expect(controller.handleKeyDown(baseEvent({ key: 't' }))).toBe(true)
      expect(controller.handleKeyDown(baseEvent({ key: 's' }))).toBe(true)
      expect(controller.handleKeyDown(baseEvent({ key: 'x' }))).toBe(true)
      expect(controller.handleKeyDown(baseEvent({ key: 'd' }))).toBe(true)
      expect(controller.handleKeyDown(baseEvent({ key: 'c' }))).toBe(true)

      expect(store.get().selection.selectedId).toBe(selectedBefore)
      expect(store.get().terminals.activePanel).toBeNull()
      expect(store.get().spawnMenu.view).toBe('closed')
      expect(store.get().systemView.view).toBe('closed')
      expect(store.get().diffView.view).toBe('closed')
      expect(terminal.focusActivePanel).not.toHaveBeenCalled()
      expect(store.get().compareView.view).toBe('open') // still open, untouched by the no-ops
    })

    it('⌘K/Ctrl+K and ⌘P/Ctrl+P still work while compare is open', () => {
      const { store, controller } = setup(null, MAC)
      withRunningCamada(store, 'root', ['child-1'])
      controller.handleKeyDown(baseEvent({ key: 'c' }))

      expect(controller.handleKeyDown(baseEvent({ key: 'k', metaKey: true }))).toBe(true)
      expect(store.get().commandPalette.view).toBe('open')

      expect(controller.handleKeyDown(baseEvent({ key: 'p', metaKey: true }))).toBe(true)
      expect(store.get().projectSelector.view).toBe('open')
    })

    it('Escape closes an open compareView', () => {
      const { store, controller } = setup(null)
      withRunningCamada(store, 'root', ['child-1'])
      controller.handleKeyDown(baseEvent({ key: 'c' }))

      const handled = controller.handleKeyDown(baseEvent({ key: 'Escape' }))

      expect(handled).toBe(true)
      expect(store.get().compareView.view).toBe('closed')
    })

    it('x is a suppressed no-op while compare is open — system view never opens underneath it', () => {
      const { store, controller } = setup('a')
      withRunningCamada(store, 'root', ['child-1'])
      controller.handleKeyDown(baseEvent({ key: 'c' }))
      controller.handleKeyDown(baseEvent({ key: 'x' }))
      expect(store.get().systemView.view).toBe('closed')
      expect(store.get().compareView.view).toBe('open')
    })

    it('d is a suppressed no-op while compare is open — diff view never opens underneath it', () => {
      const { store, controller } = setup('a')
      withRunningCamada(store, 'root', ['child-1'])
      controller.handleKeyDown(baseEvent({ key: 'c' }))
      controller.handleKeyDown(baseEvent({ key: 'd' }))
      expect(store.get().diffView.view).toBe('closed')
      expect(store.get().compareView.view).toBe('open')
    })

    it('c is a suppressed no-op while system is open — compareView never opens underneath it', () => {
      const { store, controller } = setup('a')
      withRunningCamada(store, 'root', ['child-1'])
      controller.handleKeyDown(baseEvent({ key: 'x' }))
      controller.handleKeyDown(baseEvent({ key: 'c' }))
      expect(store.get().compareView.view).toBe('closed')
      expect(store.get().systemView.view).toBe('open')
    })
  })

  describe('Esc height-pop — final rung of the precedence ladder (KEY-06)', () => {
    it('pops a pushed height only after the whole existing ladder has declined', () => {
      const { heights, controller } = setup('a')
      heights.pop = vi.fn(() => true)

      const handled = controller.handleKeyDown(baseEvent({ key: 'Escape' }))

      expect(handled).toBe(true)
      expect(heights.pop).toHaveBeenCalledOnce()
    })

    it('Escape returns false when the height stack is empty (heights.pop returns false)', () => {
      const { terminal, controller } = setup('a')

      const handled = controller.handleKeyDown(baseEvent({ key: 'Escape' }))

      expect(handled).toBe(false)
      expect(terminal.closeActiveSession).not.toHaveBeenCalled()
    })

    it('an open terminal still wins over heights.pop (ladder order preserved)', () => {
      const { heights, terminal, controller } = setup('a')
      controller.handleKeyDown(baseEvent({ key: 't' }))

      const handled = controller.handleKeyDown(baseEvent({ key: 'Escape' }))

      expect(handled).toBe(true)
      expect(terminal.closeActiveSession).toHaveBeenCalledOnce()
      expect(heights.pop).not.toHaveBeenCalled()
    })
  })
})
