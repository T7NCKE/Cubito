import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitCapabilityCache } from '../shared/git-capability-cache'
import type { GitExec } from './git-handler-ops'
import { mergeWinnerIntoParentRelayOp } from './git-handler-merge-winner-ops'

const tempRoots: string[] = []

function gitSync(repo: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

const relayGit: GitExec = async (args, cwd) => {
  try {
    return { stdout: gitSync(cwd, args), stderr: '' }
  } catch (error) {
    const stdout = (error as { stdout?: Buffer | string }).stdout
    const stderr = (error as { stderr?: Buffer | string }).stderr
    throw Object.assign(error as Error, {
      stdout: stdout ? String(stdout) : '',
      stderr: stderr ? String(stderr) : ''
    })
  }
}

async function createParentAndWinnerWorktrees(): Promise<{ parentDir: string; winnerDir: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'orca-relay-merge-winner-'))
  tempRoots.push(root)
  const repo = path.join(root, 'repo')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  gitSync(repo, ['config', 'user.email', 'test@example.com'])
  gitSync(repo, ['config', 'user.name', 'Test User'])
  gitSync(repo, ['config', 'commit.gpgSign', 'false'])
  await writeFile(path.join(repo, 'base.txt'), 'base\n')
  gitSync(repo, ['add', '-A'])
  gitSync(repo, ['commit', '-q', '-m', 'base'])

  const parentDir = path.join(root, 'parent')
  const winnerDir = path.join(root, 'winner')
  gitSync(repo, ['worktree', 'add', '-q', '-b', 'parent-branch', parentDir])
  gitSync(repo, ['worktree', 'add', '-q', '-b', 'winner-branch', winnerDir])
  return { parentDir, winnerDir }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('mergeWinnerIntoParentRelayOp', () => {
  it('commit-trees the merged tree and moves the parent branch ref on a clean merge', async () => {
    const { parentDir, winnerDir } = await createParentAndWinnerWorktrees()
    await writeFile(path.join(winnerDir, 'winner-only.txt'), 'winner\n')
    gitSync(winnerDir, ['add', '-A'])
    gitSync(winnerDir, ['commit', '-q', '-m', 'winner change'])
    const winnerTip = gitSync(winnerDir, ['rev-parse', 'HEAD'])
    const parentTipBefore = gitSync(parentDir, ['rev-parse', 'HEAD'])

    const result = await mergeWinnerIntoParentRelayOp(
      relayGit,
      new GitCapabilityCache(),
      parentDir,
      winnerDir,
      'Merge winner into parent'
    )

    expect(result.outcome).toBe('clean')
    if (result.outcome !== 'clean') {
      throw new Error('expected clean outcome')
    }
    expect(gitSync(parentDir, ['rev-parse', 'refs/heads/parent-branch'])).toBe(result.commitOid)
    expect(gitSync(parentDir, [`rev-parse`, `${result.commitOid}^1`])).toBe(parentTipBefore)
    expect(gitSync(parentDir, [`rev-parse`, `${result.commitOid}^2`])).toBe(winnerTip)
  })

  it('returns the conflicted file list and mutates nothing on a conflict', async () => {
    const { parentDir, winnerDir } = await createParentAndWinnerWorktrees()
    await writeFile(path.join(parentDir, 'base.txt'), 'parent-version\n')
    gitSync(parentDir, ['add', '-A'])
    gitSync(parentDir, ['commit', '-q', '-m', 'parent edits base'])
    const parentTipBefore = gitSync(parentDir, ['rev-parse', 'refs/heads/parent-branch'])
    await writeFile(path.join(winnerDir, 'base.txt'), 'winner-version\n')
    gitSync(winnerDir, ['add', '-A'])
    gitSync(winnerDir, ['commit', '-q', '-m', 'winner edits base'])

    const result = await mergeWinnerIntoParentRelayOp(
      relayGit,
      new GitCapabilityCache(),
      parentDir,
      winnerDir,
      'Merge winner into parent'
    )

    expect(result).toEqual({ outcome: 'conflict', files: ['base.txt'] })
    expect(gitSync(parentDir, ['rev-parse', 'refs/heads/parent-branch'])).toBe(parentTipBefore)
  })
})

describe('mergeWinnerIntoParentRelayOp with syncWorkingTree', () => {
  it('syncs a clean parent working tree when syncWorkingTree is true', async () => {
    const { parentDir, winnerDir } = await createParentAndWinnerWorktrees()
    await writeFile(path.join(winnerDir, 'winner-only.txt'), 'winner\n')
    gitSync(winnerDir, ['add', '-A'])
    gitSync(winnerDir, ['commit', '-q', '-m', 'winner change'])

    const result = await mergeWinnerIntoParentRelayOp(
      relayGit,
      new GitCapabilityCache(),
      parentDir,
      winnerDir,
      'Merge winner into parent',
      true
    )

    expect(result.outcome).toBe('clean')
    if (result.outcome !== 'clean') {
      throw new Error('expected clean outcome')
    }
    expect(result.workingTree).toEqual({ status: 'synced' })
    expect(gitSync(parentDir, ['status', '--porcelain'])).toBe('')
    expect(await readFile(path.join(parentDir, 'winner-only.txt'), 'utf8')).toBe('winner\n')
  })

  it('blocks without moving the ref when an untracked parent file would be overwritten', async () => {
    const { parentDir, winnerDir } = await createParentAndWinnerWorktrees()
    await writeFile(path.join(winnerDir, 'new.txt'), 'winner\n')
    gitSync(winnerDir, ['add', '-A'])
    gitSync(winnerDir, ['commit', '-q', '-m', 'winner change'])
    await writeFile(path.join(parentDir, 'new.txt'), 'untracked\n')
    const parentTipBefore = gitSync(parentDir, ['rev-parse', 'refs/heads/parent-branch'])

    const result = await mergeWinnerIntoParentRelayOp(
      relayGit,
      new GitCapabilityCache(),
      parentDir,
      winnerDir,
      'Merge winner into parent',
      true
    )

    expect(result).toEqual({
      outcome: 'blocked',
      reason: 'untracked-overwrite',
      paths: ['new.txt']
    })
    expect(gitSync(parentDir, ['rev-parse', 'refs/heads/parent-branch'])).toBe(parentTipBefore)
    expect(gitSync(parentDir, ['status', '--porcelain'])).toBe('?? new.txt')
  })

  it('returns already-merged without a new commit on a repeated merge', async () => {
    const { parentDir, winnerDir } = await createParentAndWinnerWorktrees()
    await writeFile(path.join(winnerDir, 'winner-only.txt'), 'winner\n')
    gitSync(winnerDir, ['add', '-A'])
    gitSync(winnerDir, ['commit', '-q', '-m', 'winner change'])
    const merge = (): ReturnType<typeof mergeWinnerIntoParentRelayOp> =>
      mergeWinnerIntoParentRelayOp(
        relayGit,
        new GitCapabilityCache(),
        parentDir,
        winnerDir,
        'Merge winner into parent',
        true
      )
    await merge()
    const tipAfterFirst = gitSync(parentDir, ['rev-parse', 'refs/heads/parent-branch'])

    const second = await merge()

    expect(second).toEqual({ outcome: 'already-merged', commitOid: tipAfterFirst })
    expect(gitSync(parentDir, ['rev-parse', 'refs/heads/parent-branch'])).toBe(tipAfterFirst)
  })

  it('omits the workingTree field when syncWorkingTree is not requested', async () => {
    const { parentDir, winnerDir } = await createParentAndWinnerWorktrees()
    await writeFile(path.join(winnerDir, 'winner-only.txt'), 'winner\n')
    gitSync(winnerDir, ['add', '-A'])
    gitSync(winnerDir, ['commit', '-q', '-m', 'winner change'])

    const result = await mergeWinnerIntoParentRelayOp(
      relayGit,
      new GitCapabilityCache(),
      parentDir,
      winnerDir,
      'Merge winner into parent'
    )

    expect(result.outcome).toBe('clean')
    expect('workingTree' in result).toBe(false)
  })

  it('does not attempt a sync when the merge conflicts even with syncWorkingTree true', async () => {
    const { parentDir, winnerDir } = await createParentAndWinnerWorktrees()
    await writeFile(path.join(parentDir, 'base.txt'), 'parent-version\n')
    gitSync(parentDir, ['add', '-A'])
    gitSync(parentDir, ['commit', '-q', '-m', 'parent edits base'])
    await writeFile(path.join(winnerDir, 'base.txt'), 'winner-version\n')
    gitSync(winnerDir, ['add', '-A'])
    gitSync(winnerDir, ['commit', '-q', '-m', 'winner edits base'])

    const result = await mergeWinnerIntoParentRelayOp(
      relayGit,
      new GitCapabilityCache(),
      parentDir,
      winnerDir,
      'Merge winner into parent',
      true
    )

    expect(result).toEqual({ outcome: 'conflict', files: ['base.txt'] })
    expect('workingTree' in result).toBe(false)
  })
})
