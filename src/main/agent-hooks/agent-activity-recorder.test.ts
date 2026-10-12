import { describe, expect, it } from 'vitest'
import { createAgentActivityRecorder, type AgentActivityHookEvent } from './agent-activity-recorder'

function hookEvent(overrides: Partial<AgentActivityHookEvent> = {}): AgentActivityHookEvent {
  return {
    paneKey: 'pane-1',
    worktreeId: 'repo-1::/repo/app',
    receivedAt: 1000,
    payload: { state: 'working', toolName: 'Edit', toolInput: '/repo/app/src/a.ts' },
    ...overrides
  }
}

describe('createAgentActivityRecorder', () => {
  it('redacts secrets in a run command before it is recorded for the wire', () => {
    const recorder = createAgentActivityRecorder()

    const recorded = recorder.observe(
      hookEvent({
        payload: {
          state: 'working',
          toolName: 'Bash',
          toolInput: 'orca orchestration send --dispatch-capability dcap_abc123 --token hunter2'
        }
      })
    )

    expect(recorded).toMatchObject({
      kind: 'run',
      target: 'orca orchestration send --dispatch-capability ‹redacted› --token ‹redacted›'
    })
  })

  it('records a PreToolUse Edit with a relativized target and agent', () => {
    const recorder = createAgentActivityRecorder()

    const recorded = recorder.observe(
      hookEvent({
        payload: {
          state: 'working',
          agentType: 'claude',
          toolName: 'Edit',
          toolInput: '/repo/app/src/a.ts'
        }
      })
    )

    expect(recorded).toMatchObject({
      kind: 'edit',
      target: 'src/a.ts',
      at: 1000,
      agent: 'claude'
    })
  })

  it('ignores a matching PostToolUse carrying the same toolUseId', () => {
    const recorder = createAgentActivityRecorder()
    recorder.observe(hookEvent({ toolUseId: 'tu-1' }))

    const second = recorder.observe(hookEvent({ toolUseId: 'tu-1', receivedAt: 1500 }))

    expect(second).toBeNull()
  })

  it('ignores repeated (toolName, toolInput) with no toolUseId on the same pane (Stop inheritance)', () => {
    const recorder = createAgentActivityRecorder()
    recorder.observe(hookEvent())

    const second = recorder.observe(hookEvent({ receivedAt: 2000 }))

    expect(second).toBeNull()
  })

  it('records a different tool on the same pane', () => {
    const recorder = createAgentActivityRecorder()
    recorder.observe(hookEvent())

    const second = recorder.observe(
      hookEvent({
        payload: { state: 'working', toolName: 'Read', toolInput: '/repo/app/src/b.ts' }
      })
    )

    expect(second).not.toBeNull()
    expect(second?.kind).toBe('read')
  })

  it('does not dedupe across two different panes', () => {
    const recorder = createAgentActivityRecorder()
    recorder.observe(hookEvent({ paneKey: 'pane-a' }))

    const other = recorder.observe(hookEvent({ paneKey: 'pane-b' }))

    expect(other).not.toBeNull()
  })

  it('ignores replay events', () => {
    const recorder = createAgentActivityRecorder()

    expect(recorder.observe(hookEvent({ isReplay: true }))).toBeNull()
  })

  it('ignores provider-session-only events', () => {
    const recorder = createAgentActivityRecorder()

    expect(recorder.observe(hookEvent({ providerSessionOnly: true }))).toBeNull()
  })

  it('ignores events with no worktreeId', () => {
    const recorder = createAgentActivityRecorder()

    expect(recorder.observe(hookEvent({ worktreeId: undefined }))).toBeNull()
  })

  it('ignores events missing toolName or toolInput', () => {
    const recorder = createAgentActivityRecorder()

    expect(
      recorder.observe(hookEvent({ payload: { state: 'working', toolInput: '/repo/app/x' } }))
    ).toBeNull()
    expect(
      recorder.observe(hookEvent({ payload: { state: 'working', toolName: 'Edit' } }))
    ).toBeNull()
  })

  it('keeps a run command verbatim rather than relativizing it', () => {
    const recorder = createAgentActivityRecorder()

    const recorded = recorder.observe(
      hookEvent({ payload: { state: 'working', toolName: 'Bash', toolInput: 'pnpm test' } })
    )

    expect(recorded?.target).toBe('pnpm test')
    expect(recorded?.kind).toBe('run')
  })

  it('clears the pane key on state done, allowing a repeat afterwards', () => {
    const recorder = createAgentActivityRecorder()
    recorder.observe(hookEvent())
    recorder.observe(hookEvent({ payload: { state: 'done' } }))

    const afterDone = recorder.observe(hookEvent({ receivedAt: 3000 }))

    expect(afterDone).not.toBeNull()
  })

  it('caps the dedupe map at 300 panes while still deduping recent ones', () => {
    const recorder = createAgentActivityRecorder()
    for (let i = 0; i < 300; i++) {
      recorder.observe(hookEvent({ paneKey: `pane-${i}` }))
    }

    const repeatOfRecent = recorder.observe(hookEvent({ paneKey: 'pane-299' }))

    expect(repeatOfRecent).toBeNull()
  })
})
