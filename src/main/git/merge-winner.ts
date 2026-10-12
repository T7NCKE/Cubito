import {
  resolveCompareRef,
  resolveMergeBase,
  resolveRefOid
} from './source-control/compare-ref-oids'
import type { GitRuntimeOptions } from './git-runtime-options'
import { gitOptionsForWorktree } from './git-runtime-options'
import { mergeTreeWriteTree } from './merge-tree-write-tree'
import {
  commitWinnerMergeAtomically,
  type MergeWinnerBlocked,
  type ParentWorkingTreeSyncResult
} from '../../shared/merge-winner-atomic-commit'
import type { ParentDependencySetupResult } from './merge-winner-dependency-setup'
import { gitExecFileAsync } from './runner'
import { runWithGitReadCacheInvalidation } from './status'
import { runWithGitWorktreeOperationLock } from '../../shared/git-worktree-operation-lock'

export type MergeWinnerOptions = GitRuntimeOptions & { syncWorkingTree?: boolean }

export type MergeWinnerResult =
  | {
      outcome: 'clean'
      commitOid: string
      workingTree?: ParentWorkingTreeSyncResult
      /** Set only when the parent setup hook re-ran because dependency files changed. */
      dependencySetup?: ParentDependencySetupResult
    }
  | { outcome: 'conflict'; files: string[] }
  | MergeWinnerBlocked
  /** The parent already contains the winner; commitOid is the untouched parent tip. */
  | { outcome: 'already-merged'; commitOid: string }

/**
 * Headless-merges the winner branch tip into the parent branch tip. Sibling
 * worktrees share one object DB, so winnerTip is reachable from parentPath.
 * Conflict, blocked sync or already-merged -> zero mutation. Clean -> 2-parent
 * commit-tree + a guarded update-ref move of the parent branch, under the worktree op lock.
 */
export async function mergeWinnerIntoParent(
  parentPath: string,
  winnerPath: string,
  message: string,
  options: MergeWinnerOptions = {}
): Promise<MergeWinnerResult> {
  const parentBranch = await resolveCompareRef(parentPath, options)
  const parentTip = await resolveRefOid(parentPath, 'HEAD', options)
  const winnerTip = await resolveRefOid(winnerPath, 'HEAD', options)
  const mergeBase = await resolveMergeBase(parentPath, parentTip, winnerTip, options)
  if (mergeBase === winnerTip) {
    return { outcome: 'already-merged', commitOid: parentTip }
  }

  const { treeOid, conflictedFiles } = await mergeTreeWriteTree(
    parentPath,
    mergeBase,
    parentTip,
    winnerTip,
    options
  )
  if (conflictedFiles.length > 0) {
    return { outcome: 'conflict', files: conflictedFiles }
  }

  return runWithGitWorktreeOperationLock(parentPath, options.signal, () =>
    runWithGitReadCacheInvalidation(() =>
      commitWinnerMergeAtomically(
        (args) => gitExecFileAsync(args, gitOptionsForWorktree(parentPath, options)),
        {
          parentRef: `refs/heads/${parentBranch}`,
          parentTip,
          winnerTip,
          treeOid,
          message,
          syncWorkingTree: options.syncWorkingTree === true
        }
      )
    )
  )
}
