import type { GitCapabilityCache } from '../shared/git-capability-cache'
import {
  isUnsupportedMergeTreeMergeBaseError,
  isUnsupportedMergeTreeWriteTreeError
} from '../shared/git-merge-tree-capability'
import {
  commitWinnerMergeAtomically,
  type MergeWinnerCommitResult
} from '../shared/merge-winner-atomic-commit'
import type { GitExec } from './git-handler-ops'

export type RelayMergeWinnerResult =
  | MergeWinnerCommitResult
  | { outcome: 'conflict'; files: string[] }
  | { outcome: 'already-merged'; commitOid: string }

/**
 * Raw-git reimplementation of src/main/git/merge-winner.ts for the relay
 * bundle, which cannot import the main-process primitive. Keep the git
 * sequence identical to avoid drift between the two.
 */
export async function mergeWinnerIntoParentRelayOp(
  git: GitExec,
  capabilities: GitCapabilityCache,
  parentPath: string,
  winnerPath: string,
  message: string,
  syncWorkingTree = false
): Promise<RelayMergeWinnerResult> {
  const parentBranch = await resolveCurrentBranch(git, parentPath)
  const parentTip = await resolveHeadOid(git, parentPath)
  const winnerTip = await resolveHeadOid(git, winnerPath)
  const { stdout: mergeBaseOut } = await git(['merge-base', parentTip, winnerTip], parentPath)
  const mergeBase = mergeBaseOut.trim()
  if (mergeBase === winnerTip) {
    return { outcome: 'already-merged', commitOid: parentTip }
  }

  const { treeOid, conflictedFiles } = await runMergeTreeWriteTree(
    git,
    capabilities,
    parentPath,
    mergeBase,
    parentTip,
    winnerTip
  )
  if (conflictedFiles.length > 0) {
    return { outcome: 'conflict', files: conflictedFiles }
  }

  return commitWinnerMergeAtomically((args) => git(args, parentPath), {
    parentRef: `refs/heads/${parentBranch}`,
    parentTip,
    winnerTip,
    treeOid,
    message,
    syncWorkingTree
  })
}

async function resolveCurrentBranch(git: GitExec, worktreePath: string): Promise<string> {
  try {
    const { stdout } = await git(['branch', '--show-current'], worktreePath)
    return stdout.trim() || 'HEAD'
  } catch {
    return 'HEAD'
  }
}

async function resolveHeadOid(git: GitExec, worktreePath: string): Promise<string> {
  const { stdout } = await git(['rev-parse', '--verify', '--end-of-options', 'HEAD'], worktreePath)
  return stdout.trim()
}

async function runMergeTreeWriteTree(
  git: GitExec,
  capabilities: GitCapabilityCache,
  repoPath: string,
  mergeBase: string,
  headOid: string,
  baseOid: string
): Promise<{ treeOid: string; conflictedFiles: string[] }> {
  const modernArgs = [
    'merge-tree',
    '--write-tree',
    '--name-only',
    '-z',
    '--no-messages',
    '--merge-base',
    mergeBase,
    headOid,
    baseOid
  ]
  const legacyArgs = [
    'merge-tree',
    '--write-tree',
    '--name-only',
    '-z',
    '--no-messages',
    headOid,
    baseOid
  ]
  return capabilities.runWithFallback(
    'merge-tree-write-tree',
    () =>
      capabilities.runWithFallback(
        'merge-tree-merge-base',
        () => runMergeTree(git, repoPath, modernArgs),
        () => runMergeTree(git, repoPath, legacyArgs),
        isUnsupportedMergeTreeMergeBaseError
      ),
    async () => {
      // Why: git before 2.38 cannot derive a reliable real-merge tree/conflict list; fail closed.
      throw new Error('Git merge-tree --write-tree is unavailable on this execution host.')
    },
    isUnsupportedMergeTreeWriteTreeError
  )
}

async function runMergeTree(
  git: GitExec,
  repoPath: string,
  args: string[]
): Promise<{ treeOid: string; conflictedFiles: string[] }> {
  try {
    const { stdout } = await git(args, repoPath)
    return parseMergeTreeOutput(stdout)
  } catch (error) {
    if (isUnsupportedMergeTreeWriteTreeError(error)) {
      throw error
    }
    // Why: merge-tree --write-tree exits 1 for conflicts but still writes tree OID + file list.
    const stdoutFromError = getGitErrorStdout(error)
    if (stdoutFromError) {
      return parseMergeTreeOutput(stdoutFromError)
    }
    throw error
  }
}

function parseMergeTreeOutput(stdout: string): { treeOid: string; conflictedFiles: string[] } {
  const entries = stdout.split('\0').filter(Boolean)
  if (entries.length === 0) {
    return { treeOid: '', conflictedFiles: [] }
  }
  const [treeOid, ...conflictedFiles] = entries
  return { treeOid, conflictedFiles }
}

function getGitErrorStdout(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return ''
  }
  const stdout = (error as Record<string, unknown>).stdout
  return typeof stdout === 'string' ? stdout : ''
}
