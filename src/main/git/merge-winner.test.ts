import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mergeWinnerIntoParent } from './merge-winner'
import { invalidateGitReadCaches } from './status'

const tempRoots: string[] = []

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

async function createParentAndWinnerWorktrees(): Promise<{ parentDir: string; winnerDir: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'orca-merge-winner-'))
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
  return { parentDir, winnerDir }
}

async function commitFile(worktree: string, file: string, content: string): Promise<void> {
  await writeFile(path.join(worktree, file), content)
  git(worktree, ['add', '-A'])
  git(worktree, ['commit', '-q', '-m', `commit ${file}`])
}

afterEach(async () => {
  invalidateGitReadCaches()
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('mergeWinnerIntoParent against a real repository', () => {
  it('commit-trees the merged tree with 2 parents and moves the parent branch ref on a clean merge', async () => {
    const { parentDir, winnerDir } = await createParentAndWinnerWorktrees()
    await writeFile(path.join(parentDir, 'parent-only.txt'), 'parent\n')
    git(parentDir, ['add', '-A'])
    git(parentDir, ['commit', '-q', '-m', 'parent change'])
    const parentBeforeMerge = git(parentDir, ['rev-parse', 'HEAD'])
    await writeFile(path.join(winnerDir, 'winner-only.txt'), 'winner\n')
    git(winnerDir, ['add', '-A'])
    git(winnerDir, ['commit', '-q', '-m', 'winner change'])
    const winnerTip = git(winnerDir, ['rev-parse', 'HEAD'])

    const result = await mergeWinnerIntoParent(parentDir, winnerDir, 'Merge winner into parent')

    expect(result.outcome).toBe('clean')
    if (result.outcome !== 'clean') {
      throw new Error('expected clean outcome')
    }
    expect(git(parentDir, ['rev-parse', 'refs/heads/parent-branch'])).toBe(result.commitOid)
    expect(git(parentDir, ['rev-parse', `${result.commitOid}^1`])).toBe(parentBeforeMerge)
    expect(git(parentDir, ['rev-parse', `${result.commitOid}^2`])).toBe(winnerTip)
    expect(git(parentDir, ['show', '--pretty=%s', '-s', result.commitOid])).toBe(
      'Merge winner into parent'
    )
  })

  it('returns the conflicted file list and mutates nothing when the merge conflicts', async () => {
    const { parentDir, winnerDir } = await createParentAndWinnerWorktrees()
    await writeFile(path.join(parentDir, 'base.txt'), 'parent-version\n')
    git(parentDir, ['add', '-A'])
    git(parentDir, ['commit', '-q', '-m', 'parent edits base'])
    const parentTipBefore = git(parentDir, ['rev-parse', 'refs/heads/parent-branch'])
    await writeFile(path.join(winnerDir, 'base.txt'), 'winner-version\n')
    git(winnerDir, ['add', '-A'])
    git(winnerDir, ['commit', '-q', '-m', 'winner edits base'])

    const result = await mergeWinnerIntoParent(parentDir, winnerDir, 'Merge winner into parent')

    expect(result).toEqual({ outcome: 'conflict', files: ['base.txt'] })
    expect(git(parentDir, ['rev-parse', 'refs/heads/parent-branch'])).toBe(parentTipBefore)
  })

  it('leaves uncommitted parent changes untouched and excluded from the merge', async () => {
    const { parentDir, winnerDir } = await createParentAndWinnerWorktrees()
    await writeFile(path.join(winnerDir, 'winner-only.txt'), 'winner\n')
    git(winnerDir, ['add', '-A'])
    git(winnerDir, ['commit', '-q', '-m', 'winner change'])
    await writeFile(path.join(parentDir, 'base.txt'), 'uncommitted-edit\n')

    const result = await mergeWinnerIntoParent(parentDir, winnerDir, 'Merge winner into parent')

    expect(result.outcome).toBe('clean')
    // Why: committed-OID semantics — the uncommitted edit is neither merged nor reverted.
    const status = git(parentDir, ['status', '--porcelain'])
    expect(status).toContain('base.txt')
  })
})

describe('mergeWinnerIntoParent with syncWorkingTree', () => {
  it('syncs a clean parent working tree when syncWorkingTree is true', async () => {
    const { parentDir, winnerDir } = await createParentAndWinnerWorktrees()
    await writeFile(path.join(winnerDir, 'winner-only.txt'), 'winner\n')
    git(winnerDir, ['add', '-A'])
    git(winnerDir, ['commit', '-q', '-m', 'winner change'])

    const result = await mergeWinnerIntoParent(parentDir, winnerDir, 'Merge winner into parent', {
      syncWorkingTree: true
    })

    expect(result.outcome).toBe('clean')
    if (result.outcome !== 'clean') {
      throw new Error('expected clean outcome')
    }
    expect(result.workingTree).toEqual({ status: 'synced' })
    expect(git(parentDir, ['status', '--porcelain'])).toBe('')
    expect(await readFile(path.join(parentDir, 'winner-only.txt'), 'utf8')).toBe('winner\n')
  })

  it('syncs and carries over a dirty parent file the merge does not touch', async () => {
    const { parentDir, winnerDir } = await createParentAndWinnerWorktrees()
    await commitFile(winnerDir, 'winner-only.txt', 'winner\n')
    await writeFile(path.join(parentDir, 'base.txt'), 'dirty\n')

    const result = await mergeWinnerIntoParent(parentDir, winnerDir, 'Merge winner into parent', {
      syncWorkingTree: true
    })

    expect(result).toMatchObject({ outcome: 'clean', workingTree: { status: 'synced' } })
    expect(await readFile(path.join(parentDir, 'base.txt'), 'utf8')).toBe('dirty\n')
    expect(git(parentDir, ['status', '--porcelain'])).toBe('M base.txt')
  })

  it('blocks without moving the ref when an untracked parent file would be overwritten', async () => {
    const { parentDir, winnerDir } = await createParentAndWinnerWorktrees()
    await commitFile(winnerDir, 'new.txt', 'winner\n')
    await writeFile(path.join(parentDir, 'new.txt'), 'untracked\n')
    const parentTipBefore = git(parentDir, ['rev-parse', 'refs/heads/parent-branch'])

    const result = await mergeWinnerIntoParent(parentDir, winnerDir, 'Merge winner into parent', {
      syncWorkingTree: true
    })

    expect(result).toEqual({
      outcome: 'blocked',
      reason: 'untracked-overwrite',
      paths: ['new.txt']
    })
    expect(git(parentDir, ['rev-parse', 'refs/heads/parent-branch'])).toBe(parentTipBefore)
    expect(git(parentDir, ['status', '--porcelain'])).toBe('?? new.txt')
    expect(await readFile(path.join(parentDir, 'new.txt'), 'utf8')).toBe('untracked\n')
  })

  it('merges and syncs once the blocking untracked file is moved away', async () => {
    const { parentDir, winnerDir } = await createParentAndWinnerWorktrees()
    await commitFile(winnerDir, 'new.txt', 'winner\n')
    await writeFile(path.join(parentDir, 'new.txt'), 'untracked\n')
    await mergeWinnerIntoParent(parentDir, winnerDir, 'Merge', { syncWorkingTree: true })
    await rm(path.join(parentDir, 'new.txt'))

    const result = await mergeWinnerIntoParent(parentDir, winnerDir, 'Merge', {
      syncWorkingTree: true
    })

    expect(result).toMatchObject({ outcome: 'clean', workingTree: { status: 'synced' } })
    expect(git(parentDir, ['status', '--porcelain'])).toBe('')
  })

  it('blocks without moving the ref when a dirty parent file is one the merge changes', async () => {
    const { parentDir, winnerDir } = await createParentAndWinnerWorktrees()
    await commitFile(winnerDir, 'base.txt', 'winner-version\n')
    await writeFile(path.join(parentDir, 'base.txt'), 'dirty\n')
    const parentTipBefore = git(parentDir, ['rev-parse', 'refs/heads/parent-branch'])

    const result = await mergeWinnerIntoParent(parentDir, winnerDir, 'Merge winner into parent', {
      syncWorkingTree: true
    })

    expect(result).toEqual({ outcome: 'blocked', reason: 'dirty-parent', paths: ['base.txt'] })
    expect(git(parentDir, ['rev-parse', 'refs/heads/parent-branch'])).toBe(parentTipBefore)
    expect(await readFile(path.join(parentDir, 'base.txt'), 'utf8')).toBe('dirty\n')
  })

  it('omits the workingTree field when syncWorkingTree is not requested', async () => {
    const { parentDir, winnerDir } = await createParentAndWinnerWorktrees()
    await writeFile(path.join(winnerDir, 'winner-only.txt'), 'winner\n')
    git(winnerDir, ['add', '-A'])
    git(winnerDir, ['commit', '-q', '-m', 'winner change'])

    const result = await mergeWinnerIntoParent(parentDir, winnerDir, 'Merge winner into parent')

    expect(result.outcome).toBe('clean')
    expect('workingTree' in result).toBe(false)
  })

  it('does not attempt a sync when the merge conflicts even with syncWorkingTree true', async () => {
    const { parentDir, winnerDir } = await createParentAndWinnerWorktrees()
    await writeFile(path.join(parentDir, 'base.txt'), 'parent-version\n')
    git(parentDir, ['add', '-A'])
    git(parentDir, ['commit', '-q', '-m', 'parent edits base'])
    await writeFile(path.join(winnerDir, 'base.txt'), 'winner-version\n')
    git(winnerDir, ['add', '-A'])
    git(winnerDir, ['commit', '-q', '-m', 'winner edits base'])

    const result = await mergeWinnerIntoParent(parentDir, winnerDir, 'Merge winner into parent', {
      syncWorkingTree: true
    })

    expect(result).toEqual({ outcome: 'conflict', files: ['base.txt'] })
    expect('workingTree' in result).toBe(false)
  })
})

describe('mergeWinnerIntoParent idempotency', () => {
  it('returns already-merged without a new commit when the parent already contains the winner', async () => {
    const { parentDir, winnerDir } = await createParentAndWinnerWorktrees()
    await commitFile(winnerDir, 'winner-only.txt', 'winner\n')
    const first = await mergeWinnerIntoParent(parentDir, winnerDir, 'Merge', {
      syncWorkingTree: true
    })
    const tipAfterFirst = git(parentDir, ['rev-parse', 'refs/heads/parent-branch'])

    const second = await mergeWinnerIntoParent(parentDir, winnerDir, 'Merge', {
      syncWorkingTree: true
    })

    expect(first.outcome).toBe('clean')
    expect(second).toEqual({ outcome: 'already-merged', commitOid: tipAfterFirst })
    expect(git(parentDir, ['rev-parse', 'refs/heads/parent-branch'])).toBe(tipAfterFirst)
  })
})
