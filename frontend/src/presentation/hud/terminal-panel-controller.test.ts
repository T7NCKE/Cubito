import { describe, expect, it, vi } from 'vitest'
import { t } from '../../application/i18n/translate'
import { createTerminalPanelController } from './terminal-panel-controller'
import type { TerminalPanelControllerDeps } from './terminal-panel-controller'
import { emptyTerminalsState, reduceTerminals } from '../../application/terminal-session-model'
import type { TerminalAction, TerminalsState } from '../../application/terminal-session-model'
import type {
  TerminalStreamPort,
  TerminalStreamSink
} from '../../application/ports/terminal-stream-port'
import type { TerminalPanelHandle } from './terminal-panel-element'
import type { TerminalConnectorHandle } from './terminal-connector-element'

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

type FakePanel = TerminalPanelHandle & {
  writes: Uint8Array[]
  resetCalls: number
  fitCalls: number
  disposed: boolean
  emitData(data: string): void
  emitResize(cols: number, rows: number): void
}

const createFakePanel = (): FakePanel => {
  let dataCb: ((data: string) => void) | null = null
  let resizeCb: ((cols: number, rows: number) => void) | null = null
  const panel: FakePanel = {
    object: {
      position: { set: vi.fn() },
      center: { set: vi.fn() }
    } as unknown as TerminalPanelHandle['object'],
    element: { offsetWidth: 520, offsetHeight: 360 } as HTMLElement,
    writes: [],
    resetCalls: 0,
    fitCalls: 0,
    disposed: false,
    apply: vi.fn(),
    write(bytes: Uint8Array) {
      panel.writes.push(bytes)
    },
    reset() {
      panel.resetCalls++
    },
    fit() {
      panel.fitCalls++
    },
    dimensions() {
      return { cols: 80, rows: 24 }
    },
    onData(cb) {
      dataCb = cb
      return () => (dataCb = null)
    },
    onResize(cb) {
      resizeCb = cb
      return () => (resizeCb = null)
    },
    focus: vi.fn(),
    blur: vi.fn(),
    setPlaced: vi.fn(),
    dispose() {
      panel.disposed = true
    },
    emitData(data) {
      dataCb?.(data)
    },
    emitResize(cols, rows) {
      resizeCb?.(cols, rows)
    }
  }
  return panel
}

const createFakeConnector = (): TerminalConnectorHandle & {
  applyCalls: number
  hideCalls: number
} => {
  const handle = {
    svg: {} as SVGSVGElement,
    applyCalls: 0,
    hideCalls: 0,
    apply: vi.fn(() => {
      handle.applyCalls++
    }),
    hide: vi.fn(() => {
      handle.hideCalls++
    }),
    dispose: vi.fn()
  }
  return handle
}

const createFakePort = (): TerminalStreamPort & { sinks: Map<number, TerminalStreamSink> } => {
  const sinks = new Map<number, TerminalStreamSink>()
  return {
    sinks,
    createTerminal: vi.fn(async (worktree: string) => ({ terminal: `handle-${worktree}` })),
    listTerminals: vi.fn(async () => []),
    subscribe: vi.fn((streamId: number, _terminal: string, _viewport, sink: TerminalStreamSink) => {
      sinks.set(streamId, sink)
    }),
    sendInput: vi.fn(),
    sendResize: vi.fn(),
    unsubscribe: vi.fn(),
    close: vi.fn(async () => {})
  }
}

const openedState = (nodeId = 'repo::/wt/a', forceNew = false): TerminalsState =>
  reduceTerminals(emptyTerminalsState(), {
    type: 'open-terminal-for-node',
    nodeId,
    forceNew
  })

// Panel screen center = pivot-shifted position; recover it from the last center.set call.
const placedCenter = (
  panel: FakePanel,
  anchor: { x: number; y: number },
  box = { w: 520, h: 360 }
) => {
  const [cx, cy] = (panel.object.center.set as ReturnType<typeof vi.fn>).mock.calls.at(-1)!
  return { x: anchor.x + (0.5 - cx) * box.w, y: anchor.y + (0.5 - cy) * box.h }
}

const setup = () => {
  const port = createFakePort()
  const panels: FakePanel[] = []
  const connector = createFakeConnector()
  const labelLayer = { add: vi.fn(), remove: vi.fn() }
  const hud = { appendChild: vi.fn() }
  const dispatch = vi.fn<(action: TerminalAction) => void>()
  const deps: TerminalPanelControllerDeps = {
    port,
    createPanel: () => {
      const p = createFakePanel()
      panels.push(p)
      return p
    },
    createConnector: () => connector,
    labelLayer,
    hud,
    dispatch,
    nodeCenter: vi.fn(() => ({ x: 1, y: 2, z: 3 })),
    cubeRect: vi.fn(() => null),
    projectToNdc: vi.fn((world) => ({ x: world.x, y: world.y, z: 0 })),
    viewport: () => ({ width: 1000, height: 800 })
  }
  const controller = createTerminalPanelController(deps)
  return { controller, port, panels, connector, labelLayer, hud, dispatch, deps }
}

describe('createTerminalPanelController', () => {
  it('mounts the connector svg into the hud container at construction (CRITICAL-1)', () => {
    const { connector, hud } = setup()
    expect(hud.appendChild).toHaveBeenCalledWith(connector.svg)
  })

  it('does nothing when there is no active panel', () => {
    const { controller, panels } = setup()
    controller.sync(emptyTerminalsState())
    expect(panels).toHaveLength(0)
  })

  it('mounts a panel into the scene label layer and creates+subscribes the terminal', async () => {
    const { controller, port, panels, labelLayer } = setup()
    controller.sync(openedState())
    await flush()
    expect(panels).toHaveLength(1)
    expect(labelLayer.add).toHaveBeenCalledWith(panels[0]!.object)
    expect(port.createTerminal).toHaveBeenCalledWith('repo::/wt/a')
    expect(port.subscribe).toHaveBeenCalledWith(
      1,
      'handle-repo::/wt/a',
      { cols: 80, rows: 24 },
      expect.anything()
    )
  })

  it('pipes sink output straight to the panel, bypassing dispatch after the first chunk', async () => {
    const { controller, port, panels, dispatch } = setup()
    controller.sync(openedState())
    await flush()
    const sink = port.sinks.get(1)!
    const bytes = new Uint8Array([1, 2, 3])
    sink.write(bytes)
    expect(panels[0]!.writes).toEqual([bytes])
    expect(dispatch).toHaveBeenCalledWith({ type: 'output-arrived', streamId: 1 })
    dispatch.mockClear()
    sink.write(new Uint8Array([4]))
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('resets the panel on snapshot start and dispatches subscribed on onSubscribed', async () => {
    const { controller, port, panels, dispatch } = setup()
    controller.sync(openedState())
    await flush()
    const sink = port.sinks.get(1)!
    sink.onSnapshotStart({})
    expect(panels[0]!.resetCalls).toBe(1)
    sink.onSubscribed({ streamId: 1, terminal: 'handle-repo::/wt/a', cols: 80, rows: 24 })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'subscribed',
      streamId: 1,
      terminal: 'handle-repo::/wt/a',
      cols: 80,
      rows: 24
    })
    // fit-on-subscribed nudges the shell (SIGWINCH) so it draws its first prompt on open.
    expect(panels[0]!.fitCalls).toBe(1)
  })

  it('wires panel input to port.sendInput and panel resize to port.sendResize', async () => {
    const { controller, port, panels } = setup()
    controller.sync(openedState())
    await flush()
    panels[0]!.emitData('ls\n')
    expect(port.sendInput).toHaveBeenCalledWith(1, 'ls\n')
    panels[0]!.emitResize(100, 30)
    expect(port.sendResize).toHaveBeenCalledWith(1, 100, 30)
  })

  it('positions the panel object from nodeCenter each tick', async () => {
    const { controller, panels, deps } = setup()
    controller.sync(openedState())
    await flush()
    controller.tick()
    expect(deps.nodeCenter).toHaveBeenCalledWith('repo::/wt/a')
    expect(panels[0]!.object.position.set).toHaveBeenCalled()
  })

  it('places the panel above the cube without covering it', async () => {
    const { controller, panels, deps } = setup()
    // ndc (0,0) -> screen (500,400) on the 1000x800 viewport; cube 40px square around it.
    deps.projectToNdc = vi.fn(() => ({ x: 0, y: 0, z: 0 }))
    const cube = { left: 480, top: 380, right: 520, bottom: 420 }
    deps.cubeRect = vi.fn(() => cube)
    controller.sync(openedState())
    await flush()
    controller.tick()
    const center = placedCenter(panels[0]!, { x: 500, y: 400 })
    expect(center.y + 180).toBeLessThanOrEqual(cube.top)
    expect(center.x).toBeCloseTo(500)
  })

  it('keeps the panel inside the viewport for a node near the left edge', async () => {
    const { controller, panels, deps } = setup()
    deps.projectToNdc = vi.fn(() => ({ x: -0.9, y: 0.2, z: 0 }))
    deps.cubeRect = vi.fn(() => ({ left: 30, top: 300, right: 70, bottom: 340 }))
    controller.sync(openedState())
    await flush()
    controller.tick()
    const center = placedCenter(panels[0]!, { x: 50, y: 320 })
    expect(center.x - 260).toBeGreaterThanOrEqual(12 - 1e-6)
  })

  it('moves below the cube when it sits at the top edge', async () => {
    const { controller, panels, deps } = setup()
    deps.projectToNdc = vi.fn(() => ({ x: 0, y: 0.9, z: 0 }))
    const cube = { left: 480, top: 20, right: 520, bottom: 60 }
    deps.cubeRect = vi.fn(() => cube)
    controller.sync(openedState())
    await flush()
    controller.tick()
    const center = placedCenter(panels[0]!, { x: 500, y: 40 })
    expect(center.y - 180).toBeGreaterThanOrEqual(cube.bottom)
  })

  it('stays hidden and unpositioned until the panel has been measured', async () => {
    const { controller, panels, connector } = setup()
    controller.sync(openedState())
    await flush()
    const element = panels[0]!.element as unknown as { offsetWidth: number }
    element.offsetWidth = 0
    controller.tick()
    expect(panels[0]!.setPlaced).toHaveBeenLastCalledWith(false)
    expect(panels[0]!.object.center.set).not.toHaveBeenCalled()
    expect(connector.hideCalls).toBeGreaterThan(0)
    element.offsetWidth = 520
    controller.tick()
    expect(panels[0]!.setPlaced).toHaveBeenLastCalledWith(true)
    expect(panels[0]!.object.center.set).toHaveBeenCalled()
  })

  it('applies the dashed connector in scene placement and hides it in hud placement', async () => {
    const { controller, connector } = setup()
    controller.sync(openedState())
    await flush()
    controller.tick()
    expect(connector.applyCalls).toBe(1)

    const hudState = reduceTerminals(openedState(), { type: 'set-placement', placement: 'hud' })
    controller.sync(hudState)
    controller.tick()
    expect(connector.hideCalls).toBeGreaterThan(0)
  })

  it('reparents the same panel instance across placement changes instead of recreating it', async () => {
    const { controller, panels, labelLayer, hud } = setup()
    controller.sync(openedState())
    await flush()
    const hudState = reduceTerminals(openedState(), { type: 'set-placement', placement: 'hud' })
    controller.sync(hudState)
    expect(panels).toHaveLength(1)
    expect(labelLayer.remove).toHaveBeenCalledWith(panels[0]!.object)
    expect(hud.appendChild).toHaveBeenCalledWith(panels[0]!.element)
  })

  it('unmounts and disposes the panel when the active panel disappears', async () => {
    const { controller, panels, labelLayer } = setup()
    const state = openedState()
    controller.sync(state)
    await flush()
    const closed = reduceTerminals(state, { type: 'close-terminal', streamId: 1 })
    controller.sync(closed)
    expect(panels[0]!.disposed).toBe(true)
    expect(labelLayer.remove).toHaveBeenCalledWith(panels[0]!.object)
  })

  it('unmounts the old panel and mounts a new one when the active session changes', async () => {
    const { controller, panels } = setup()
    let state = openedState('repo::/wt/a')
    controller.sync(state)
    await flush()
    state = reduceTerminals(state, { type: 'open-terminal-for-node', nodeId: 'repo::/wt/b' })
    controller.sync(state)
    await flush()
    expect(panels).toHaveLength(2)
    expect(panels[0]!.disposed).toBe(true)
    expect(panels[1]!.disposed).toBe(false)
  })

  it('unsubscribes on the port whenever the currently mounted panel unmounts', async () => {
    const { controller, port } = setup()
    const state = openedState()
    controller.sync(state)
    await flush()
    controller.sync(reduceTerminals(state, { type: 'close-terminal', streamId: 1 }))
    expect(port.unsubscribe).toHaveBeenCalledWith(1)
  })

  describe('P6.4 — multiplex tabs on the same node', () => {
    it('reuses the cached PTY handle when switching back to an already-subscribed tab — no duplicate terminal.create', async () => {
      const { controller, port } = setup()
      let state = openedState('repo::/wt/a') // tab 1 -> streamId 1
      controller.sync(state)
      await flush()
      port.sinks.get(1)!.onSubscribed({ streamId: 1, terminal: 'pty-1', cols: 80, rows: 24 })
      state = reduceTerminals(state, {
        type: 'subscribed',
        streamId: 1,
        terminal: 'pty-1',
        cols: 80,
        rows: 24
      })

      // Open a second tab on the same node -> streamId 2 becomes active.
      state = reduceTerminals(state, { type: 'open-terminal-for-node', nodeId: 'repo::/wt/a' })
      controller.sync(state)
      await flush()
      expect(port.createTerminal).toHaveBeenCalledTimes(2)

      // Cycle back to tab 1 (already subscribed) — must NOT create a new terminal.
      state = reduceTerminals(state, { type: 'next-tab', nodeId: 'repo::/wt/a' })
      controller.sync(state)
      await flush()

      expect(port.createTerminal).toHaveBeenCalledTimes(2)
      expect(port.subscribe).toHaveBeenCalledWith(
        1,
        'pty-1',
        { cols: 80, rows: 24 },
        expect.anything()
      )
    })
  })

  describe('attach [t] to an existing host terminal before spawning a new one (v3-3)', () => {
    it('attaches to the agent-tagged terminal when the host lists more than one', async () => {
      const { controller, port, panels } = setup()
      port.listTerminals = vi.fn(async () => [
        { handle: 'pty-shell', title: null, connected: true },
        { handle: 'pty-agent', agentIdentity: 'claude', title: null, connected: true }
      ])
      controller.sync(openedState())
      await flush()
      expect(port.listTerminals).toHaveBeenCalledWith('repo::/wt/a')
      expect(port.createTerminal).not.toHaveBeenCalled()
      expect(port.subscribe).toHaveBeenCalledWith(
        1,
        'pty-agent',
        { cols: 80, rows: 24 },
        expect.anything()
      )
      expect(panels).toHaveLength(1)
    })

    it('attaches to the first listed terminal when none carries an agentIdentity', async () => {
      const { controller, port } = setup()
      port.listTerminals = vi.fn(async () => [
        { handle: 'pty-first', title: null, connected: true },
        { handle: 'pty-second', title: null, connected: true }
      ])
      controller.sync(openedState())
      await flush()
      expect(port.createTerminal).not.toHaveBeenCalled()
      expect(port.subscribe).toHaveBeenCalledWith(
        1,
        'pty-first',
        { cols: 80, rows: 24 },
        expect.anything()
      )
    })

    it('sets the localized agent session title once attached to an agent-tagged pty', async () => {
      const { controller, port, dispatch } = setup()
      port.listTerminals = vi.fn(async () => [
        { handle: 'pty-agent', agentIdentity: 'claude', title: null, connected: true }
      ])
      controller.sync(openedState())
      await flush()
      port.sinks.get(1)!.onSubscribed({ streamId: 1, terminal: 'pty-agent', cols: 80, rows: 24 })
      expect(dispatch).toHaveBeenCalledWith({
        type: 'subscribed',
        streamId: 1,
        terminal: 'pty-agent',
        cols: 80,
        rows: 24,
        title: t('terminal.agentTitle')
      })
    })

    it('falls back to createTerminal when the host lists no terminals', async () => {
      const { controller, port } = setup()
      port.listTerminals = vi.fn(async () => [])
      controller.sync(openedState())
      await flush()
      expect(port.createTerminal).toHaveBeenCalledWith('repo::/wt/a')
      expect(port.subscribe).toHaveBeenCalledWith(
        1,
        'handle-repo::/wt/a',
        { cols: 80, rows: 24 },
        expect.anything()
      )
    })

    it('falls back to createTerminal when listTerminals rejects — a list failure never blocks opening the panel', async () => {
      const { controller, port } = setup()
      port.listTerminals = vi.fn(async () => {
        throw new Error('boom')
      })
      controller.sync(openedState())
      await flush()
      expect(port.createTerminal).toHaveBeenCalledWith('repo::/wt/a')
      expect(port.subscribe).toHaveBeenCalledWith(
        1,
        'handle-repo::/wt/a',
        { cols: 80, rows: 24 },
        expect.anything()
      )
    })

    it('forceNew:true bypasses listTerminals entirely and always spawns a fresh pty', async () => {
      const { controller, port } = setup()
      port.listTerminals = vi.fn(async () => [
        { handle: 'pty-agent', agentIdentity: 'claude', title: null, connected: true }
      ])
      controller.sync(openedState('repo::/wt/a', true))
      await flush()
      expect(port.listTerminals).not.toHaveBeenCalled()
      expect(port.createTerminal).toHaveBeenCalledWith('repo::/wt/a')
      expect(port.subscribe).toHaveBeenCalledWith(
        1,
        'handle-repo::/wt/a',
        { cols: 80, rows: 24 },
        expect.anything()
      )
    })
  })

  describe('focus/close/rebind commands', () => {
    it('focusActivePanel() focuses the mounted panel, no-ops with nothing mounted', async () => {
      const { controller, panels } = setup()
      controller.focusActivePanel() // no-op, nothing mounted
      controller.sync(openedState())
      await flush()
      controller.focusActivePanel()
      expect(panels[0]!.focus).toHaveBeenCalledOnce()
    })

    it('exitFocus() blurs the mounted panel and dispatches set-focused:false', async () => {
      const { controller, panels, dispatch } = setup()
      controller.sync(openedState())
      await flush()
      controller.exitFocus()
      expect(panels[0]!.blur).toHaveBeenCalledOnce()
      expect(dispatch).toHaveBeenCalledWith({ type: 'set-focused', focused: false })
    })

    it("the panel's onExit callback (Ctrl+] chord) routes through exitFocus", async () => {
      const { controller, deps, panels, dispatch } = setup()
      const createPanelSpy = vi.spyOn(deps, 'createPanel')
      controller.sync(openedState())
      await flush()
      const onExit = createPanelSpy.mock.calls[0]![0]
      onExit()
      expect(panels[0]!.blur).toHaveBeenCalledOnce()
      expect(dispatch).toHaveBeenCalledWith({ type: 'set-focused', focused: false })
    })

    it('closeActiveSession() unsubscribes + closes the handle on the port, then dispatches close-terminal', async () => {
      const { controller, port, dispatch } = setup()
      controller.sync(openedState())
      await flush()
      port.sinks.get(1)!.onSubscribed({ streamId: 1, terminal: 'pty-1', cols: 80, rows: 24 })

      controller.closeActiveSession()

      expect(port.unsubscribe).toHaveBeenCalledWith(1)
      expect(port.close).toHaveBeenCalledWith('pty-1')
      expect(dispatch).toHaveBeenCalledWith({ type: 'close-terminal', streamId: 1 })
    })

    it('closeActiveSession() is a no-op with nothing mounted', () => {
      const { controller, port, dispatch } = setup()
      controller.closeActiveSession()
      expect(port.unsubscribe).not.toHaveBeenCalled()
      expect(dispatch).not.toHaveBeenCalled()
    })

    it('rebind() resubscribes the mounted session on the fresh port without recreating the panel', async () => {
      const { controller, panels } = setup()
      controller.sync(openedState())
      await flush()
      const newPort = createFakePort()

      controller.rebind(newPort)
      await flush()

      expect(newPort.createTerminal).toHaveBeenCalledWith('repo::/wt/a')
      expect(newPort.subscribe).toHaveBeenCalledWith(
        1,
        'handle-repo::/wt/a',
        { cols: 80, rows: 24 },
        expect.anything()
      )
      expect(panels).toHaveLength(1) // same xterm instance reused, not recreated
    })

    it('rebind() before anything is mounted just swaps the port for the next mount', () => {
      const { controller } = setup()
      const newPort = createFakePort()
      expect(() => controller.rebind(newPort)).not.toThrow()
    })
  })
})
