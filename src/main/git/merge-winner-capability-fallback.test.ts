import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mergeTreeWriteTreeMock = vi.hoisted(() => vi.fn())
vi.mock('./merge-tree-write-tree', () => ({ mergeTreeWriteTree: mergeTreeWriteTreeMock }))

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
  const root = await mkdtemp(path.join(tmpdir(), 'orca-merge-winner-fallback-'))
  tempRoots.push(root)
  const repo = path.join(root, 'repo')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  git(repo, ['config', 'user.email', 'test@example.com'])
  git(repo, ['config', 'user.name', 'Test User'])
  git(repo, ['config', 'commit.gpgSign', 'false'])
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'base'], { cwd: repo })

  const parentDir = path.join(root, 'parent')
  const winnerDir = path.join(root, 'winner')
  git(repo, ['worktree', 'add', '-q', '-b', 'parent-branch', parentDir])
  git(repo, ['worktree', 'add', '-q', '-b', 'winner-branch', winnerDir])
  // Why: a winner with no commits of its own short-circuits as already-merged before merge-tree.
  git(winnerDir, ['commit', '-q', '--allow-empty', '-m', 'winner'])
  return { parentDir, winnerDir }
}

afterEach(async () => {
  mergeTreeWriteTreeMock.mockReset()
  invalidateGitReadCaches()
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('mergeWinnerIntoParent below the merge-tree --write-tree floor', () => {
  it('propagates the primitive fail-closed error and mutates nothing', async () => {
    const { parentDir, winnerDir } = await createParentAndWinnerWorktrees()
    const parentTipBefore = git(parentDir, ['rev-parse', 'refs/heads/parent-branch'])
    mergeTreeWriteTreeMock.mockRejectedValue(
      new Error('Git merge-tree --write-tree is unavailable on this execution host.')
    )

    await expect(
      mergeWinnerIntoParent(parentDir, winnerDir, 'Merge winner into parent')
    ).rejects.toThrow('Git merge-tree --write-tree is unavailable on this execution host.')
    expect(git(parentDir, ['rev-parse', 'refs/heads/parent-branch'])).toBe(parentTipBefore)
  })
})
