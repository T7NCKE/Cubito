/** Runs git in the parent worktree; rejects on a non-zero exit (stderr on the error when known). */
export type MergeWinnerGitRun = (args: string[]) => Promise<{ stdout: string }>

export type ParentWorkingTreeSyncResult =
  | { status: 'synced' }
  // Why: only older hosts emit 'skipped'; kept so the type still describes every wire value.
  | { status: 'skipped'; reason: 'dirty' }
  // Merged but unsynced: the ref moved and could not be rolled back. previousOid enables recovery.
  | { status: 'failed'; message: string; previousOid?: string }

export type MergeWinnerBlockReason =
  | 'untracked-overwrite'
  | 'dirty-parent'
  | 'sync-refused'
  | 'sync-failed'

export type MergeWinnerBlocked = {
  outcome: 'blocked'
  reason: MergeWinnerBlockReason
  paths: string[]
  message?: string
}

export type MergeWinnerCommitResult =
  | { outcome: 'clean'; commitOid: string; workingTree?: ParentWorkingTreeSyncResult }
  | MergeWinnerBlocked

export type MergeWinnerCommitInput = {
  parentRef: string
  parentTip: string
  winnerTip: string
  treeOid: string
  message: string
  syncWorkingTree: boolean
}

/**
 * Commits the merged tree and moves the parent ref so that, when a working-tree sync is asked
 * for, the user never sees a moved ref over a stale index (that state stages the merge's
 * reverse). Preflights the sync first; a post-move sync failure rolls the ref back with CAS.
 * Caller holds the parent's worktree op lock.
 */
export async function commitWinnerMergeAtomically(
  run: MergeWinnerGitRun,
  input: MergeWinnerCommitInput
): Promise<MergeWinnerCommitResult> {
  const { parentRef, parentTip, winnerTip, treeOid, message, syncWorkingTree } = input
  if (syncWorkingTree) {
    const blocked = await preflightParentSync(run, parentTip, treeOid)
    if (blocked) {
      return blocked
    }
  }
  const { stdout } = await run([
    'commit-tree',
    treeOid,
    '-p',
    parentTip,
    '-p',
    winnerTip,
    '-m',
    message
  ])
  const commitOid = stdout.trim()
  // Why: old-value guard makes the ref move fail loudly if parentTip moved underneath us.
  await run(['update-ref', parentRef, commitOid, parentTip])
  if (!syncWorkingTree) {
    return { outcome: 'clean', commitOid }
  }
  try {
    await run(['read-tree', '-u', '-m', parentTip, treeOid])
    return { outcome: 'clean', commitOid, workingTree: { status: 'synced' } }
  } catch (syncError) {
    const syncMessage = gitErrorText(syncError)
    try {
      await run(['update-ref', parentRef, parentTip, commitOid])
      return { outcome: 'blocked', reason: 'sync-failed', paths: [], message: syncMessage }
    } catch {
      return {
        outcome: 'clean',
        commitOid,
        workingTree: { status: 'failed', message: syncMessage, previousOid: parentTip }
      }
    }
  }
}

async function preflightParentSync(
  run: MergeWinnerGitRun,
  parentTip: string,
  treeOid: string
): Promise<MergeWinnerBlocked | null> {
  const changed = await listPaths(run, [
    'diff-tree',
    '-r',
    '-z',
    '--name-only',
    '--no-renames',
    parentTip,
    treeOid
  ])
  const changedSet = new Set(changed)
  const dirty = new Set([
    ...(await listPaths(run, ['diff', '--no-ext-diff', '--name-only', '-z', parentTip, '--'])),
    ...(await listPaths(run, ['diff', '--no-ext-diff', '--cached', '--name-only', '-z', parentTip]))
  ])
  const dirtyOverlap = [...dirty].filter((file) => changedSet.has(file)).sort()
  if (dirtyOverlap.length > 0) {
    return { outcome: 'blocked', reason: 'dirty-parent', paths: dirtyOverlap }
  }
  const untracked = await listPaths(run, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '--directory',
    '-z'
  ])
  const collisions = untracked.filter((entry) => changed.some((file) => collides(file, entry)))
  if (collisions.length > 0) {
    return { outcome: 'blocked', reason: 'untracked-overwrite', paths: collisions.sort() }
  }
  // Why: stat-only dirtiness makes read-tree report "not uptodate"; refresh like `git status`.
  await run(['update-index', '-q', '--refresh']).catch(() => undefined)
  try {
    // Authoritative dry run (git >= 1.6): catches anything the path checks above missed.
    await run(['read-tree', '-n', '-u', '-m', parentTip, treeOid])
  } catch (error) {
    return { outcome: 'blocked', reason: 'sync-refused', paths: [], message: gitErrorText(error) }
  }
  return null
}

async function listPaths(run: MergeWinnerGitRun, args: string[]): Promise<string[]> {
  const { stdout } = await run(args)
  return stdout.split('\0').filter(Boolean)
}

/** `--directory` lists a wholly untracked folder once, with a trailing slash. */
function collides(changedPath: string, untrackedEntry: string): boolean {
  if (untrackedEntry.endsWith('/')) {
    return changedPath.startsWith(untrackedEntry) || `${changedPath}/` === untrackedEntry
  }
  return changedPath === untrackedEntry || changedPath.startsWith(`${untrackedEntry}/`)
}

function gitErrorText(error: unknown): string {
  const stderr = (error as { stderr?: unknown } | null)?.stderr
  if (typeof stderr === 'string' && stderr.trim()) {
    return stderr.trim()
  }
  return error instanceof Error ? error.message : String(error)
}
