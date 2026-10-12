import { afterEach, describe, expect, it } from 'vitest'
import { agentActivityToFeedRow } from './agent-activity-to-feed'
import { formatClockTime } from './clock-time'
import { setActiveLanguage } from './i18n/translate'
import type { AgentActivityEvent } from './ports/runtime-gateway'

/** Same formatter the mapper uses, so the assertion is TZ- and ICU-independent. */
const expectedTime = formatClockTime

const AT = 1_700_000_000_123

const baseEvent = (overrides: Partial<AgentActivityEvent> = {}): AgentActivityEvent => ({
  seq: 7,
  at: AT,
  kind: 'read',
  tool: 'Read',
  target: 'src/routes/auth.ts',
  ...overrides
})

describe('agentActivityToFeedRow', () => {
  it('maps a read event', () => {
    const row = agentActivityToFeedRow(baseEvent({ kind: 'read', target: 'src/routes/auth.ts' }))
    expect(row).toEqual({
      id: 'activity-7',
      time: expectedTime(AT),
      kind: 'read',
      text: 'leyó src/routes/auth.ts'
    })
  })

  it('maps an edit event', () => {
    const row = agentActivityToFeedRow(baseEvent({ kind: 'edit', target: 'POST /auth/retry' }))
    expect(row.text).toBe('editando POST /auth/retry')
    expect(row.kind).toBe('edit')
  })

  it('maps a create event', () => {
    const row = agentActivityToFeedRow(baseEvent({ kind: 'create', target: 'POST /auth/refresh' }))
    expect(row.text).toBe('nuevo POST /auth/refresh')
    expect(row.kind).toBe('create')
  })

  it('maps a run event', () => {
    const row = agentActivityToFeedRow(baseEvent({ kind: 'run', target: 'pnpm test auth.retry' }))
    expect(row.text).toBe('corrió pnpm test auth.retry')
    expect(row.kind).toBe('run')
  })

  it('ids the row from seq and never sets detail/highlighted', () => {
    const row = agentActivityToFeedRow(baseEvent({ seq: 42 }))
    expect(row.id).toBe('activity-42')
    expect('detail' in row).toBe(false)
    expect('highlighted' in row).toBe(false)
  })

  it('formats the time in the active UI language', () => {
    setActiveLanguage('es')
    const at = new Date(2026, 0, 1, 13, 2, 3).getTime()
    expect(agentActivityToFeedRow(baseEvent({ at })).time).toBe('13:02:03')
  })
})

const row = (kind: 'read' | 'edit' | 'create' | 'run') =>
  agentActivityToFeedRow({ seq: 1, at: 0, kind, target: 'x' } as never).text

describe('agentActivityToFeedRow (en)', () => {
  afterEach(() => setActiveLanguage('es'))

  it('uses English verbs', () => {
    setActiveLanguage('en')
    expect([row('read'), row('edit'), row('create'), row('run')]).toEqual([
      'read x',
      'editing x',
      'new x',
      'ran x'
    ])
  })
})
