import type { CompareMergeState } from '../../application/compare-view-model'
import { createTwoStepButton } from '../hud/two-step-button'
import { t } from '../../application/i18n/translate'
import { describeFailure, plainFailure } from '../../application/i18n/user-facing-error'
import type { FailureMessage } from '../../application/i18n/user-facing-error'
import { renderFailureText } from '../failure-text-element'

export type CompareMergeActionModel = {
  /** Hidden until a winner is picked — merge never implies picking one. */
  visible: boolean
  /** False when the host lacks `git.merge-winner.v1`. */
  capable: boolean
  /** v3-2: false when the host lacks `git.merge-winner.sync.v1` — gates the sync checkbox row. */
  syncCapable: boolean
  merge: CompareMergeState
}

export type CompareMergeActionHandle = {
  readonly root: HTMLElement
  apply(model: CompareMergeActionModel): void
  /** Fires on the 2nd click of the two-step arm — never on the 1st (arm-only). Receives the
   *  sync checkbox's current value (v3-2). */
  onMergeWinner(cb: (syncWorkingTree: boolean) => void): void
  dispose(): void
}

const shortOid = (oid: string): string => oid.slice(0, 7)

/** R1: the merge is headless — it moves the parent branch ref but never touches the parent
 *  worktree's working tree, so the merged changes look uncommitted there until synced. */
const cleanText = (commitOid: string): string =>
  t('compare.mergedClean', { oid: shortOid(commitOid) })

type CleanMerge = Extract<CompareMergeState, { phase: 'clean' }>
type WorkingTreeSync = NonNullable<CleanMerge['workingTree']>

/** Merged-unsynced (ref moved, files stale): always keeps the merged oid in the lead. */
const unsyncedText = (commitOid: string, workingTree: WorkingTreeSync): FailureMessage => ({
  lead: t('compare.mergedUnsynced', { oid: shortOid(commitOid) }),
  detail:
    workingTree.status === 'failed'
      ? describeFailure('parentSync', workingTree.message).detail
      : t('compare.parentSkipped')
})

/** The merge commit's first parent is the pre-merge tip, so older hosts still get a command. */
const recoveryText = (commitOid: string, workingTree: WorkingTreeSync): string =>
  t('compare.unsyncedRecovery', {
    previous:
      workingTree.status === 'failed' && workingTree.previousOid
        ? shortOid(workingTree.previousOid)
        : `${shortOid(commitOid)}^1`
  })

/** Copy for the background parent setup-hook re-run triggered by changed package manifests. */
const dependencySetupText = (
  _setup: NonNullable<Extract<CompareMergeState, { phase: 'clean' }>['dependencySetup']>
): string => t('compare.reinstalling')

/**
 * Compare mode's winner-merge action (Change E) — a real interactive `<button>` (the keyboard-bar
 * chips are inert, they can't host this). Two-step arm is EPHEMERAL, local to this element: 1st
 * click arms a confirm, 2nd fires `onMergeWinner`, Esc/blur/going-hidden disarms. Renders the
 * conflict file list or the R1-aware success copy from the last `apply()`'d merge state.
 */
export function createCompareMergeAction(doc: Document = document): CompareMergeActionHandle {
  const root = doc.createElement('div')
  root.className = 'cubito-compare-merge-action'

  const twoStep = createTwoStepButton(doc, 'compare-merge-action__button')
  const button = twoStep.element

  const syncRow = doc.createElement('label')
  syncRow.className = 'compare-merge-action__sync'
  const syncCheckbox = doc.createElement('input')
  syncCheckbox.type = 'checkbox'
  syncCheckbox.className = 'cubito-compare-merge__sync'
  const syncText = doc.createElement('span')
  syncText.textContent = t('compare.syncParent')
  syncRow.appendChild(syncCheckbox)
  syncRow.appendChild(syncText)

  const result = doc.createElement('div')
  result.className = 'compare-merge-action__result'

  root.appendChild(button)
  root.appendChild(syncRow)
  root.appendChild(result)

  let capable = false
  let mergeCallback: ((syncWorkingTree: boolean) => void) | null = null

  // Why: sync is atomic and preflighted on capable hosts, so it is the safe default.
  syncCheckbox.checked = true
  let syncCapable = false

  const resetSyncCheckbox = (): void => {
    syncCheckbox.checked = true
  }

  twoStep.onConfirm(() => mergeCallback?.(syncCapable && syncCheckbox.checked))

  const appendLine = (modifier: string, failure: FailureMessage): void => {
    const line = doc.createElement('div')
    line.className = `compare-merge-action__result-line compare-merge-action__result-line--${modifier}`
    renderFailureText(doc, line, failure)
    result.appendChild(line)
  }

  const appendPathList = (paths: readonly string[]): void => {
    if (paths.length === 0) return
    const list = doc.createElement('ul')
    list.className = 'compare-merge-action__conflict-list'
    for (const file of paths) {
      const item = doc.createElement('li')
      item.textContent = file
      list.appendChild(item)
    }
    result.appendChild(list)
  }

  const renderClean = (merge: CleanMerge): void => {
    const { commitOid, workingTree } = merge
    if (workingTree?.status === 'failed' || workingTree?.status === 'skipped') {
      appendLine('warning', unsyncedText(commitOid, workingTree))
      appendLine('warning', plainFailure(recoveryText(commitOid, workingTree)))
      return
    }
    appendLine(
      'clean',
      plainFailure(
        workingTree?.status === 'synced'
          ? t('compare.mergedSynced', { oid: shortOid(commitOid) })
          : cleanText(commitOid)
      )
    )
    if (merge.dependencySetup) {
      appendLine('clean', plainFailure(dependencySetupText(merge.dependencySetup)))
    }
  }

  const renderResult = (merge: CompareMergeState): void => {
    result.replaceChildren()
    if (merge.phase === 'clean') {
      renderClean(merge)
    } else if (merge.phase === 'already-merged') {
      appendLine(
        'clean',
        plainFailure(t('compare.alreadyMerged', { oid: shortOid(merge.commitOid) }))
      )
    } else if (merge.phase === 'blocked') {
      appendLine('conflict', {
        lead: t(`compare.blocked.${merge.reason}`),
        detail: merge.message ? describeFailure('parentSync', merge.message).detail : null
      })
      appendPathList(merge.paths)
    } else if (merge.phase === 'conflict') {
      appendLine('conflict', plainFailure(t('compare.conflict')))
      appendPathList(merge.files)
    } else if (merge.phase === 'error') {
      appendLine('error', merge.message)
    }
  }

  return {
    root,
    apply(model) {
      root.hidden = !model.visible
      if (!model.visible) {
        twoStep.disarm()
        resetSyncCheckbox()
      }
      capable = model.capable
      twoStep.apply({
        labels: {
          idle: capable ? t('compare.merge') : t('compare.mergeUnsupported'),
          confirm: capable ? t('compare.mergeConfirm') : t('compare.mergeUnsupported'),
          busy: t('compare.merging')
        },
        busy: model.merge.phase === 'running',
        // Why: a merged winner must not re-fire (old hosts would commit a duplicate); picking a
        // different winner resets the phase.
        disabled:
          !capable || model.merge.phase === 'already-merged' || model.merge.phase === 'clean'
      })
      syncCapable = model.syncCapable
      syncRow.hidden = !model.syncCapable
      renderResult(model.merge)
    },
    onMergeWinner(cb) {
      mergeCallback = cb
    },
    dispose() {
      root.remove()
    }
  }
}
