import { redactSecrets } from '../../domain/secret-redaction'
import type { FeedRow, FeedRowKind } from '../../domain/system-graph/types'

export type ActivityFeedRowView = {
  id: string
  time: string
  glyph: string
  text: string
  detail?: string
  cssClass: string
  highlighted: boolean
}

/** Glyphs per VistaSistema.dc.html activity feed markup (lines 126-135). */
const GLYPH_BY_KIND: Record<FeedRowKind, string> = {
  read: '⏺',
  edit: '✎',
  create: '+',
  run: '▶',
  pass: '✓',
  diff: 'Δ'
}

const rowCssClass = (kind: FeedRowKind): string => `activity-row--${kind}`

/** Pure projection of the agent activity feed for the sistema-en-vivo panel. No DOM/Three. */
export function activityFeedViewModel(feed: readonly FeedRow[]): readonly ActivityFeedRowView[] {
  return feed.map((row) => ({
    id: row.id,
    time: row.time,
    glyph: GLYPH_BY_KIND[row.kind],
    text: redactSecrets(row.text),
    ...(row.detail !== undefined ? { detail: redactSecrets(row.detail) } : {}),
    cssClass: rowCssClass(row.kind),
    highlighted: row.highlighted ?? false
  }))
}
