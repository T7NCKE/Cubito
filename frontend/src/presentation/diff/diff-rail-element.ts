import type { DiffRailRow } from './diff-rail-model'
import { t } from '../../application/i18n/translate'
import type { FailureMessage } from '../../application/i18n/user-facing-error'
import { renderFailureText } from '../failure-text-element'

const buildRow = (
  doc: Document,
  row: DiffRailRow,
  onClick: (path: string) => void,
  onStageToggle: (path: string) => void
): HTMLElement => {
  const rowElement = doc.createElement('div')
  rowElement.className = row.cssClass

  const path = doc.createElement('span')
  path.className = 'diff-rail__path'
  path.title = row.path
  const dir = doc.createElement('span')
  dir.className = 'diff-rail__dir'
  dir.textContent = row.dirText
  const base = doc.createElement('span')
  base.className = 'diff-rail__base'
  base.textContent = row.baseText
  path.appendChild(dir)
  path.appendChild(base)

  const added = doc.createElement('span')
  added.className = 'diff-rail__added'
  added.textContent = row.addedText

  const removed = doc.createElement('span')
  removed.className = 'diff-rail__removed'
  removed.textContent = row.removedText

  rowElement.appendChild(path)
  rowElement.appendChild(added)
  rowElement.appendChild(removed)
  if (row.originText !== undefined) {
    const origin = doc.createElement('span')
    origin.className = 'diff-rail__origin'
    origin.textContent = row.originText
    rowElement.appendChild(origin)
  }
  if (row.oldPathText !== undefined) {
    const oldPath = doc.createElement('span')
    oldPath.className = 'diff-rail__old-path'
    oldPath.textContent = row.oldPathText
    rowElement.appendChild(oldPath)
  }
  if (row.stage !== undefined) {
    const toggle = doc.createElement('button')
    toggle.type = 'button'
    toggle.className = `diff-rail__stage diff-rail__stage--${row.stage.state}`
    toggle.textContent = row.stage.glyph
    toggle.title = row.stage.label
    toggle.addEventListener('click', (event) => {
      event.stopPropagation() // the row click selects the file; the toggle only stages
      onStageToggle(row.path)
    })
    rowElement.appendChild(toggle)
  }
  rowElement.addEventListener('click', () => onClick(row.path))
  return rowElement
}

export type DiffRailHandle = {
  readonly root: HTMLElement
  apply(rows: readonly DiffRailRow[], failure?: FailureMessage | null): void
  onSelect(cb: (path: string) => void): void
  onStageToggle(cb: (path: string) => void): void
  dispose(): void
}

/**
 * Diff mode's left rail (file list) — mirrors activity-feed-element.ts's rebuild-on-apply
 * pattern. Row cssClass comes straight from diffRailViewModel, applied verbatim (already
 * encodes status + selected). A failure replaces the list (an unread rail is not an empty one); empty rows -> placeholder.
 */
export function createDiffRail(doc: Document = document): DiffRailHandle {
  const root = doc.createElement('div')
  root.className = 'cubito-diff-rail'

  let selectCallback: ((path: string) => void) | null = null
  let stageToggleCallback: ((path: string) => void) | null = null

  return {
    root,
    apply(rows: readonly DiffRailRow[], failure: FailureMessage | null = null) {
      root.replaceChildren()
      if (failure !== null) {
        const error = doc.createElement('div')
        error.className = 'cubito-diff-rail__error'
        renderFailureText(doc, error, failure)
        root.appendChild(error)
        return
      }
      if (rows.length === 0) {
        const empty = doc.createElement('div')
        empty.className = 'cubito-diff-rail__empty'
        empty.textContent = t('diff.railEmpty')
        root.appendChild(empty)
        return
      }
      for (const row of rows) {
        const rowElement = buildRow(
          doc,
          row,
          (path) => selectCallback?.(path),
          (path) => stageToggleCallback?.(path)
        )
        root.appendChild(rowElement)
        // Why: keyboard j/k can select rows below the rail's fold.
        if (row.selected) rowElement.scrollIntoView({ block: 'nearest' })
      }
    },
    onSelect(cb) {
      selectCallback = cb
    },
    onStageToggle(cb) {
      stageToggleCallback = cb
    },
    dispose() {
      root.remove()
    }
  }
}
