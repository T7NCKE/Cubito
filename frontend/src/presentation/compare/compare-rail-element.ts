import type { CompareRailRow } from './compare-rail-model'

import { t } from '../../application/i18n/translate'
import { renderFailureText } from '../failure-text-element'

type RowEntry = {
  readonly element: HTMLElement
  readonly label: HTMLElement
  readonly stat: HTMLElement
  readonly toggle: HTMLElement
  failure: HTMLElement | null
  /** Latest projected row — the listeners read it so a reused element never acts on stale data. */
  row: CompareRailRow
}

const setText = (el: HTMLElement, text: string): void => {
  if (el.textContent !== text) el.textContent = text
}

const buildEntry = (
  doc: Document,
  row: CompareRailRow,
  onFocus: (childId: string) => void,
  onSetWinner: (childId: string | null) => void
): RowEntry => {
  const element = doc.createElement('div')
  const label = doc.createElement('span')
  label.className = 'compare-rail__label'
  const stat = doc.createElement('span')
  stat.className = 'compare-rail__stat'
  const toggle = doc.createElement('button')
  toggle.type = 'button'
  toggle.className = 'compare-rail__winner-toggle'
  const entry: RowEntry = { element, label, stat, toggle, failure: null, row }

  toggle.addEventListener('click', (event) => {
    event.stopPropagation() // the winner button lives inside the focus-on-click row
    onSetWinner(entry.row.isWinner ? null : entry.row.childId)
    toggle.blur?.() // release focus — a focused button re-fires on Enter (risk 3)
  })
  element.addEventListener('click', () => onFocus(entry.row.childId))
  element.appendChild(label)
  element.appendChild(stat)
  element.appendChild(toggle)
  return entry
}

const updateEntry = (doc: Document, entry: RowEntry, row: CompareRailRow): void => {
  const { element, label, stat, toggle } = entry
  const failureChanged =
    entry.failure === null ? row.failure !== null : entry.row.failure !== row.failure
  entry.row = row
  if (element.className !== row.cssClass) element.className = row.cssClass
  setText(label, row.label)
  label.title = row.title
  setText(stat, row.statText)
  stat.title = row.statText
  setText(toggle, row.winnerToggleLabel)
  if (!failureChanged) return
  entry.failure?.remove()
  entry.failure = null
  if (row.failure !== null) {
    const failure = doc.createElement('div')
    failure.className = 'compare-rail__error'
    renderFailureText(doc, failure, row.failure)
    element.appendChild(failure)
    entry.failure = failure
  }
}

export type CompareRailHandle = {
  readonly root: HTMLElement
  apply(rows: readonly CompareRailRow[]): void
  onFocusChild(cb: (childId: string) => void): void
  onSetWinner(cb: (childId: string | null) => void): void
  dispose(): void
}

/**
 * Compare mode's child rail (left column) — mirrors diff-rail-element.ts's rebuild-on-apply
 * pattern. A row click focuses that child (drives the middle file-rail); the winner-toggle
 * button records/clears the winner (record-only — no merge action exists here).
 */
export function createCompareRail(doc: Document = document): CompareRailHandle {
  const root = doc.createElement('div')
  root.className = 'cubito-compare-rail'

  let focusCallback: ((childId: string) => void) | null = null
  let winnerCallback: ((childId: string | null) => void) | null = null
  // Why: the store emits constantly; rebuilding rows each time detached the button under a click.
  const entries = new Map<string, RowEntry>()
  let order: readonly string[] = []

  return {
    root,
    apply(rows: readonly CompareRailRow[]) {
      if (rows.length === 0) {
        entries.clear()
        order = []
        root.replaceChildren()
        const empty = doc.createElement('div')
        empty.className = 'cubito-compare-rail__empty'
        empty.textContent = t('compare.railEmpty')
        root.appendChild(empty)
        return
      }
      if (order.length === 0) root.replaceChildren()
      const wanted = new Set(rows.map((row) => row.childId))
      for (const [childId, entry] of entries) {
        if (wanted.has(childId)) continue
        entry.element.remove()
        entries.delete(childId)
      }
      for (const row of rows) {
        let entry = entries.get(row.childId)
        if (!entry) {
          entry = buildEntry(
            doc,
            row,
            (childId) => focusCallback?.(childId),
            (childId) => winnerCallback?.(childId)
          )
          entries.set(row.childId, entry)
        }
        updateEntry(doc, entry, row)
      }
      const nextOrder = rows.map((row) => row.childId)
      if (nextOrder.length !== order.length || nextOrder.some((id, i) => id !== order[i])) {
        for (const id of nextOrder) root.appendChild(entries.get(id)!.element)
      }
      order = nextOrder
    },
    onFocusChild(cb) {
      focusCallback = cb
    },
    onSetWinner(cb) {
      winnerCallback = cb
    },
    dispose() {
      root.remove()
    }
  }
}
