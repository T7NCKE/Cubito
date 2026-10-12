import type { DiffPanelLineView, DiffPanelView } from './diff-panel-model'
import { t } from '../../application/i18n/translate'
import { plainFailure } from '../../application/i18n/user-facing-error'
import { renderFailureText } from '../failure-text-element'

const buildLineRow = (doc: Document, line: DiffPanelLineView): HTMLElement => {
  const row = doc.createElement('div')
  row.className = line.cssClass

  const oldNo = doc.createElement('span')
  oldNo.className = 'diff-panel__gutter diff-panel__gutter--old'
  oldNo.textContent = line.oldNo === null ? '' : String(line.oldNo)

  const newNo = doc.createElement('span')
  newNo.className = 'diff-panel__gutter diff-panel__gutter--new'
  newNo.textContent = line.newNo === null ? '' : String(line.newNo)

  const text = doc.createElement('span')
  text.className = 'diff-panel__text'
  text.textContent = line.text

  row.appendChild(oldNo)
  row.appendChild(newNo)
  row.appendChild(text)
  return row
}

const buildHint = (doc: Document, cssClass: string, text: string): HTMLElement => {
  const hint = doc.createElement('div')
  hint.className = cssClass
  hint.textContent = text
  return hint
}

export type DiffPanelHandle = {
  readonly element: HTMLElement
  apply(vm: DiffPanelView): void
  dispose(): void
}

/**
 * Diff mode's right panel (unified line diff) — mirrors activity-feed-element.ts's
 * rebuild-on-apply pattern. Per-line cssClass comes straight from diffPanelViewModel.
 */
export function createDiffPanel(doc: Document = document): DiffPanelHandle {
  const element = doc.createElement('div')
  element.className = 'cubito-diff-panel'
  let lastKind: DiffPanelView['kind'] | null = null

  return {
    element,
    apply(vm: DiffPanelView) {
      // Why: a silent live refresh swaps lines for lines; the reader must keep their place.
      const keepScroll = lastKind === 'lines' && vm.kind === 'lines'
      const { scrollTop, scrollLeft } = element
      lastKind = vm.kind
      element.replaceChildren()
      switch (vm.kind) {
        case 'lines': {
          const lines = doc.createElement('div')
          lines.className = 'cubito-diff-panel__lines'
          for (const line of vm.lines) lines.appendChild(buildLineRow(doc, line))
          element.appendChild(lines)
          if (vm.truncated) {
            element.appendChild(buildHint(doc, 'cubito-diff-panel__truncated', t('diff.truncated')))
          }
          break
        }
        case 'binary':
          element.appendChild(
            buildHint(
              doc,
              'cubito-diff-panel__binary',
              vm.deleted ? `${t('diff.binary')} · ${t('diff.deleted')}` : t('diff.binary')
            )
          )
          break
        case 'loading':
          element.appendChild(buildHint(doc, 'cubito-diff-panel__loading', t('diff.loading')))
          break
        case 'idle':
          element.appendChild(buildHint(doc, 'cubito-diff-panel__idle', t('diff.idle')))
          break
        case 'error':
          const hint = buildHint(doc, 'cubito-diff-panel__error', '')
          renderFailureText(doc, hint, vm.message ?? plainFailure(t('diff.loadError')))
          element.appendChild(hint)
          break
      }
      if (keepScroll) {
        element.scrollTop = scrollTop
        element.scrollLeft = scrollLeft
      }
    },
    dispose() {
      element.remove()
    }
  }
}
