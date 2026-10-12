import { execFile, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { commitWinnerMergeAtomically, type MergeWinnerGitRun } from './merge-winner-atomic-commit'

const execFileAsync = promisify(execFile)
const tempRoots: string[] = []

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
}

/** Parent worktree at parentTip plus a winner commit adding new.txt; returns merge inputs. */
async function createMergeInputs(): Promise<{
  parentDir: string
  parentTip: string
  winnerTip: string
  treeOid: string
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'orca-merge-atomic-'))
  tempRoots.push(root)
  const repo = path.join(root, 'repo')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  git(repo, ['config', 'user.email', 'test@example.com'])
  git(repo, ['config', 'user.name', 'Test User'])
  git(repo, ['config', 'commit.gpgSign', 'false'])
  await writeFile(path.join(repo, 'base.txt'), 'base\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-q', '-m', 'base'])
  const parentDir = path.join(root, 'parent')
  const winnerDir = path.join(root, 'winner')
  git(repo, ['worktree', 'add', '-q', '-b', 'parent-branch', parentDir])
  git(repo, ['worktree', 'add', '-q', '-b', 'winner-branch', winnerDir])
  await writeFile(path.join(winnerDir, 'new.txt'), 'winner\n')
  git(winnerDir, ['add', '-A'])
  git(winnerDir, ['commit', '-q', '-m', 'winner'])
  return {
    parentDir,
    parentTip: git(parentDir, ['rev-parse', 'HEAD']),
    winnerTip: git(winnerDir, ['rev-parse', 'HEAD']),
    treeOid: git(winnerDir, ['rev-parse', 'HEAD^{tree}'])
  }
}

/** Real git in parentDir, except calls matching `fail` reject — simulates a post-preflight race. */
function gitRun(parentDir: string, fail: (args: string[]) => boolean): MergeWinnerGitRun {
  return async (args) => {
    if (fail(args)) {
      throw Object.assign(new Error('simulated failure'), { stderr: 'error: simulated' })
    }
    return execFileAsync('git', args, { cwd: parentDir })
  }
}

const isRealReadTree = (args: string[]): boolean => args[0] === 'read-tree' && !args.includes('-n')

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('commitWinnerMergeAtomically', () => {
  it('rolls the parent ref back when the sync fails after the ref moved', async () => {
    const inputs = await createMergeInputs()

    const result = await commitWinnerMergeAtomically(gitRun(inputs.parentDir, isRealReadTree), {
      ...inputs,
      parentRef: 'refs/heads/parent-branch',
      message: 'Merge',
      syncWorkingTree: true
    })

    expect(result).toEqual({
      outcome: 'blocked',
      reason: 'sync-failed',
      paths: [],
      message: 'error: simulated'
    })
    expect(git(inputs.parentDir, ['rev-parse', 'refs/heads/parent-branch'])).toBe(inputs.parentTip)
    expect(git(inputs.parentDir, ['status', '--porcelain'])).toBe('')
  })

  it('reports merged-unsynced with the previous tip when the rollback also fails', async () => {
    const inputs = await createMergeInputs()
    const rollback = (args: string[]): boolean =>
      args[0] === 'update-ref' && args[2] === inputs.parentTip

    const result = await commitWinnerMergeAtomically(
      gitRun(inputs.parentDir, (args) => isRealReadTree(args) || rollback(args)),
      { ...inputs, parentRef: 'refs/heads/parent-branch', message: 'Merge', syncWorkingTree: true }
    )

    expect(result).toMatchObject({
      outcome: 'clean',
      workingTree: { status: 'failed', message: 'error: simulated', previousOid: inputs.parentTip }
    })
  })

  it('blocks with sync-refused when only the dry run objects', async () => {
    const inputs = await createMergeInputs()

    const result = await commitWinnerMergeAtomically(
      gitRun(inputs.parentDir, (args) => args[0] === 'read-tree' && args.includes('-n')),
      { ...inputs, parentRef: 'refs/heads/parent-branch', message: 'Merge', syncWorkingTree: true }
    )

    expect(result).toEqual({
      outcome: 'blocked',
      reason: 'sync-refused',
      paths: [],
      message: 'error: simulated'
    })
    expect(git(inputs.parentDir, ['rev-parse', 'refs/heads/parent-branch'])).toBe(inputs.parentTip)
  })

  it('reports an untracked folder that holds a path the merge adds', async () => {
    const inputs = await createMergeInputs()
    await mkdir(path.join(inputs.parentDir, 'new.txt'))
    await writeFile(path.join(inputs.parentDir, 'new.txt', 'inner.txt'), 'x\n')

    const result = await commitWinnerMergeAtomically(
      gitRun(inputs.parentDir, () => false),
      {
        ...inputs,
        parentRef: 'refs/heads/parent-branch',
        message: 'Merge',
        syncWorkingTree: true
      }
    )

    expect(result).toEqual({
      outcome: 'blocked',
      reason: 'untracked-overwrite',
      paths: ['new.txt/']
    })
    expect(await readFile(path.join(inputs.parentDir, 'new.txt', 'inner.txt'), 'utf8')).toBe('x\n')
  })
})
