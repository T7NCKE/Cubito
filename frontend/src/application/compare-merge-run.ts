import { fanOutMemberIds } from './fan-out-model'
import type { FanOutSlice } from './fan-out-model'
import type { CompareViewAction, CompareViewSlice } from './compare-view-model'
import type { MergeWinnerResult, RuntimeGateway } from './ports/runtime-gateway'
import { describeFailure } from './i18n/user-facing-error'

export type CompareMergeGatewayPort = Pick<RuntimeGateway, 'gitMergeWinnerIntoParent'>

export type CompareMergeRunDeps = {
  gateway: CompareMergeGatewayPort
  dispatch: (action: CompareViewAction) => void
}

/**
 * Winner-merge runner (Change E) — fires `git.mergeWinnerIntoParent(parent, winner)`, parent
 * being the litter's own parent (`fanOutMemberIds[0]`) and winner the compare slice's chosen
 * winnerId. No-op (zero gateway calls) when compare is closed, no winner is picked, a merge is
 * already running, or the litter has no parent — mirrors set-winner's no-implicit-pick rule.
 * Headless: never touches the parent worktree's working tree (R1 — the success copy warns).
 */
export async function runCompareMerge(
  compareView: CompareViewSlice,
  fanOut: FanOutSlice,
  deps: CompareMergeRunDeps,
  syncWorkingTree = false
): Promise<void> {
  if (compareView.view !== 'open') return
  if (compareView.winnerId === null) return
  if (compareView.merge.phase === 'running') return
  const parent = fanOutMemberIds(fanOut)[0]
  if (parent === undefined) return
  const winner = compareView.winnerId

  deps.dispatch({ type: 'merge-start' })
  try {
    const result = await deps.gateway.gitMergeWinnerIntoParent(
      parent,
      winner,
      undefined,
      syncWorkingTree
    )
    deps.dispatch(mergeResultAction(result))
  } catch (error) {
    deps.dispatch({ type: 'merge-error', message: describeFailure('compareMerge', error) })
  }
}

function mergeResultAction(result: MergeWinnerResult): CompareViewAction {
  switch (result.outcome) {
    case 'clean':
      return {
        type: 'merge-clean',
        commitOid: result.commitOid,
        ...(result.workingTree ? { workingTree: result.workingTree } : {}),
        ...(result.dependencySetup ? { dependencySetup: result.dependencySetup } : {})
      }
    case 'conflict':
      return { type: 'merge-conflict', files: result.files }
    case 'blocked':
      return {
        type: 'merge-blocked',
        reason: result.reason,
        paths: result.paths,
        ...(result.message !== undefined ? { message: result.message } : {})
      }
    case 'already-merged':
      return { type: 'merge-already-merged', commitOid: result.commitOid }
  }
}
