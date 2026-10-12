import { describe, expect, it } from 'vitest'
import { terminalPanelModel } from './terminal-panel-model'
import { emptyTerminalsState } from '../../application/terminal-session-model'
import type { TerminalSession, TerminalsState } from '../../application/terminal-session-model'

const session = (overrides: Partial<TerminalSession> = {}): TerminalSession => ({
  streamId: 1,
  nodeId: 'repo::/wt/a',
  handle: 'h1',
  status: 'live',
  hasOutput: true,
  forceNew: false,
  ...overrides
})

const stateWith = (
  sessions: TerminalSession[],
  activeIndex = 0,
  placement: 'scene' | 'hud' = 'scene'
): TerminalsState => {
  const base = emptyTerminalsState()
  const byNode = new Map<string, number[]>()
  const sessionMap = new Map<number, TerminalSession>()
  for (const s of sessions) {
    sessionMap.set(s.streamId, s)
    byNode.set(s.nodeId, [...(byNode.get(s.nodeId) ?? []), s.streamId])
  }
  const nodeId = sessions[0]?.nodeId ?? 'repo::/wt/a'
  return {
    ...base,
    sessions: sessionMap,
    byNode,
    activePanel:
      sessions.length === 0 ? null : { nodeId, sessionIndex: activeIndex, placement, focused: true }
  }
}

describe('terminalPanelModel', () => {
  it('is null when there is no active panel', () => {
    expect(terminalPanelModel(emptyTerminalsState())).toBeNull()
  })

  it('is null when the active tab has no matching session', () => {
    const state = stateWith([session()])
    const dangling: TerminalsState = { ...state, sessions: new Map() }
    expect(terminalPanelModel(dangling)).toBeNull()
  })

  it('builds a header with 1-based tab index, tab count, and title', () => {
    const state = stateWith([session({ title: 'zsh' })])
    expect(terminalPanelModel(state)!.header).toBe('terminal 1/1 · zsh')
  })

  it('redacts capability tokens from tab labels and the header', () => {
    const title = 'orca send --dispatch-capability dcap_0123456789abcdef'
    const model = terminalPanelModel(stateWith([session({ title })]))!
    expect(model.header).not.toContain('dcap_0123')
    expect(model.tabs[0]!.label).not.toContain('dcap_0123')
  })

  it('falls back to "shell" when the session has no title yet', () => {
    const state = stateWith([session()])
    expect(terminalPanelModel(state)!.header).toBe('terminal 1/1 · shell')
  })

  it('reflects the active tab among several', () => {
    const state = stateWith(
      [session({ streamId: 1, title: 'a' }), session({ streamId: 2, title: 'b' })],
      1
    )
    const model = terminalPanelModel(state)!
    expect(model.header).toBe('terminal 2/2 · b')
    expect(model.activeTabIndex).toBe(1)
    expect(model.tabs).toEqual([
      { streamId: 1, label: 'a' },
      { streamId: 2, label: 'b' }
    ])
  })

  it('connector is visible only in scene placement', () => {
    const scene = terminalPanelModel(stateWith([session()], 0, 'scene'))!
    const hud = terminalPanelModel(stateWith([session()], 0, 'hud'))!
    expect(scene.connectorVisible).toBe(true)
    expect(hud.connectorVisible).toBe(false)
  })

  it('carries placement, focused, and status through from state', () => {
    const state = stateWith([session({ status: 'snapshotting' })], 0, 'hud')
    const model = terminalPanelModel(state)!
    expect(model.placement).toBe('hud')
    expect(model.focused).toBe(true)
    expect(model.status).toBe('snapshotting')
    expect(model.nodeId).toBe('repo::/wt/a')
  })

  it('never emits a raw hex value — every tone is a semantic name', () => {
    const model = terminalPanelModel(stateWith([session()]))!
    for (const tone of Object.values(model.tone)) {
      expect(tone).not.toMatch(/#|0x/)
    }
  })
})
