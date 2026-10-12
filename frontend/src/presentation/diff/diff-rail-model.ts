import type { DiffFileRow, DiffRailStatus } from '../../application/diff-view-model'
import { plainFailure } from '../../application/i18n/user-facing-error'
import type { FailureMessage } from '../../application/i18n/user-facing-error'
import type { StageState } from '../../application/source-control-flow'
import { t } from '../../application/i18n/translate'

export type DiffRailStage = { state: StageState; glyph: string; label: string }

export type DiffRailRow = {
  path: string
  /** Directory part with trailing slash ('' for root files) — the part allowed to truncate. */
  dirText: string
  /** File name — never truncated. */
  baseText: string
  status: string
  addedText: string
  removedText: string
  cssClass: string
  selected: boolean
  /** Rename hint, e.g. "a.ts →" — set only when the file has an oldPath. */
  oldPathText?: string
  /** "naciendo"/"sin commitear" badge — set only when the row has a working-tree component. */
  originText?: string
  /** Stage toggle — set only for rows git.status knows about (an uncommitted component). */
  stage?: DiffRailStage
}

const MINUS_GLYPH = '−'
/** Statuses git.status reports for a brand-new path (mirrors system-graph-file-diff.ts). */
const NACIENDO_STATUSES = new Set(['untracked', 'added', 'copied'])
const HAS_WORKING_COMPONENT = new Set(['working', 'both'])

const railCssClass = (status: string, selected: boolean, hasWorkingComponent: boolean): string =>
  `diff-rail__row diff-rail__row--${status}${hasWorkingComponent ? ' diff-rail__row--wt' : ''}${selected ? ' diff-rail__row--selected' : ''}`

const stagePresentation = (state: StageState): { glyph: string; label: string } => {
  if (state === 'staged') return { glyph: '●', label: t('diff.unstage') }
  if (state === 'partial') return { glyph: '◐', label: t('diff.stageRest') }
  return { glyph: '○', label: t('diff.stage') }
}

const originTextFor = (file: DiffFileRow): string | undefined =>
  file.origin !== undefined && HAS_WORKING_COMPONENT.has(file.origin)
    ? NACIENDO_STATUSES.has(file.status)
      ? t('diff.originBorn')
      : t('diff.originUncommitted')
    : undefined

const splitPath = (path: string): { dirText: string; baseText: string } => {
  const cut = path.lastIndexOf('/') + 1
  return { dirText: path.slice(0, cut), baseText: path.slice(cut) }
}

/** Pure projection of the diff rail's file list, selection-aware. No DOM. */
export function diffRailViewModel(
  files: readonly DiffFileRow[],
  selectedPath: string | null,
  stageStates?: ReadonlyMap<string, StageState>
): readonly DiffRailRow[] {
  return files.map((file) => {
    const stageState = stageStates?.get(file.path)
    const selected = file.path === selectedPath
    const originText = originTextFor(file)
    return {
      path: file.path,
      ...splitPath(file.path),
      status: file.status,
      addedText: `+${file.added}`,
      removedText: `${MINUS_GLYPH}${file.removed}`,
      cssClass: railCssClass(file.status, selected, originText !== undefined),
      selected,
      ...(file.oldPath === undefined ? {} : { oldPathText: `${file.oldPath} →` }),
      ...(originText === undefined ? {} : { originText }),
      ...(stageState === undefined
        ? {}
        : { stage: { state: stageState, ...stagePresentation(stageState) } })
    }
  })
}

/** The failure the rail shows instead of its empty placeholder — null unless the load errored. */
export const diffRailFailure = (
  status: DiffRailStatus,
  errorMessage: FailureMessage | undefined
): FailureMessage | null =>
  status === 'error' ? (errorMessage ?? plainFailure(t('failure.unknown'))) : null
