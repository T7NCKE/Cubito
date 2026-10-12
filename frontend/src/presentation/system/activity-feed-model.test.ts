import { describe, expect, it } from 'vitest'
import { activityFeedViewModel } from './activity-feed-model'
import type { FeedRow } from '../../domain/system-graph/types'

const row = (overrides: Partial<FeedRow> & Pick<FeedRow, 'id' | 'kind'>): FeedRow => ({
  time: '14:02:11',
  text: overrides.id,
  ...overrides
})

describe('activityFeedViewModel', () => {
  it('returns an empty list for an empty feed', () => {
    expect(activityFeedViewModel([])).toEqual([])
  })

  it('redacts secrets in text and detail', () => {
    const [view] = activityFeedViewModel([
      row({
        id: 'x',
        kind: 'run',
        text: 'run orca send --dispatch-capability dcap_0123456789abcdef',
        detail: 'Authorization: Bearer abc.def'
      })
    ])
    expect(view!.text).not.toContain('dcap_0123')
    expect(view!.detail).not.toContain('abc.def')
  })

  it('preserves feed order', () => {
    const feed = [row({ id: 'a', kind: 'read' }), row({ id: 'b', kind: 'edit' })]
    expect(activityFeedViewModel(feed).map((r) => r.id)).toEqual(['a', 'b'])
  })

  // Glyphs per VistaSistema.dc.html activity feed markup (lines 126-135).
  it.each([
    ['read', '⏺'],
    ['edit', '✎'],
    ['create', '+'],
    ['run', '▶'],
    ['pass', '✓'],
    ['diff', 'Δ']
  ] as const)('maps kind "%s" to glyph "%s"', (kind, glyph) => {
    const model = activityFeedViewModel([row({ id: 'x', kind })])
    expect(model[0]!.glyph).toBe(glyph)
  })

  it('derives cssClass from kind', () => {
    const model = activityFeedViewModel([row({ id: 'x', kind: 'edit' })])
    expect(model[0]!.cssClass).toBe('activity-row--edit')
  })

  it('passes through the highlighted flag', () => {
    const model = activityFeedViewModel([row({ id: 'x', kind: 'edit', highlighted: true })])
    expect(model[0]!.highlighted).toBe(true)
  })

  it('defaults highlighted to false when absent', () => {
    const model = activityFeedViewModel([row({ id: 'x', kind: 'read' })])
    expect(model[0]!.highlighted).toBe(false)
  })

  it('passes through detail when present', () => {
    const model = activityFeedViewModel([
      row({ id: 'x', kind: 'edit', detail: 'backoff exponencial + jitter' })
    ])
    expect(model[0]!.detail).toBe('backoff exponencial + jitter')
  })

  it('omits detail when absent, rather than setting it to undefined', () => {
    const model = activityFeedViewModel([row({ id: 'x', kind: 'read' })])
    expect('detail' in model[0]!).toBe(false)
  })
})
