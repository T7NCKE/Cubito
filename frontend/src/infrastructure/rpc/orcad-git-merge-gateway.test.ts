import { describe, expect, it, vi } from 'vitest'
import { createGitMergeMethods } from './orcad-git-merge-gateway'
import type { RpcCaller } from './orcad-gateway'

const frame = (result: unknown) => ({
  id: 'x',
  ok: true as const,
  result,
  _meta: { runtimeId: 'rt' }
})

describe('createGitMergeMethods — gitMergeWinnerIntoParent', () => {
  it('calls git.mergeWinnerIntoParent with {parent, winner} — no message by default', async () => {
    const call: RpcCaller = vi.fn(async () => frame({ outcome: 'clean', commitOid: 'c0ffee' }))
    const methods = createGitMergeMethods({ call })
    await methods.gitMergeWinnerIntoParent('repo::/parent', 'repo::/child')
    expect(call).toHaveBeenCalledWith('git.mergeWinnerIntoParent', {
      parent: 'repo::/parent',
      winner: 'repo::/child'
    })
  })

  it('passes message through when given', async () => {
    const call: RpcCaller = vi.fn(async () => frame({ outcome: 'clean', commitOid: 'c0ffee' }))
    const methods = createGitMergeMethods({ call })
    await methods.gitMergeWinnerIntoParent('repo::/parent', 'repo::/child', 'merge winner')
    expect(call).toHaveBeenCalledWith('git.mergeWinnerIntoParent', {
      parent: 'repo::/parent',
      winner: 'repo::/child',
      message: 'merge winner'
    })
  })

  it('projects a clean result to {outcome: clean, commitOid}', async () => {
    const call: RpcCaller = vi.fn(async () => frame({ outcome: 'clean', commitOid: 'abc123' }))
    const methods = createGitMergeMethods({ call })
    await expect(methods.gitMergeWinnerIntoParent('p', 'w')).resolves.toEqual({
      outcome: 'clean',
      commitOid: 'abc123'
    })
  })

  it('projects a conflict result to {outcome: conflict, files}', async () => {
    const call: RpcCaller = vi.fn(async () =>
      frame({ outcome: 'conflict', files: ['src/a.ts', 'src/b.ts'] })
    )
    const methods = createGitMergeMethods({ call })
    await expect(methods.gitMergeWinnerIntoParent('p', 'w')).resolves.toEqual({
      outcome: 'conflict',
      files: ['src/a.ts', 'src/b.ts']
    })
  })

  it('throws on a malformed clean result (missing commitOid)', async () => {
    const call: RpcCaller = vi.fn(async () => frame({ outcome: 'clean' }))
    const methods = createGitMergeMethods({ call })
    await expect(methods.gitMergeWinnerIntoParent('p', 'w')).rejects.toThrow(
      /git\.mergeWinnerIntoParent/
    )
  })

  it('throws on a malformed conflict result (files not an array)', async () => {
    const call: RpcCaller = vi.fn(async () => frame({ outcome: 'conflict' }))
    const methods = createGitMergeMethods({ call })
    await expect(methods.gitMergeWinnerIntoParent('p', 'w')).rejects.toThrow(
      /git\.mergeWinnerIntoParent/
    )
  })

  it('throws on an unrecognized outcome', async () => {
    const call: RpcCaller = vi.fn(async () => frame({ outcome: 'unknown' }))
    const methods = createGitMergeMethods({ call })
    await expect(methods.gitMergeWinnerIntoParent('p', 'w')).rejects.toThrow(
      /git\.mergeWinnerIntoParent/
    )
  })

  it('omits syncWorkingTree from the RPC params when not passed', async () => {
    const call: RpcCaller = vi.fn(async () => frame({ outcome: 'clean', commitOid: 'c0ffee' }))
    const methods = createGitMergeMethods({ call })
    await methods.gitMergeWinnerIntoParent('repo::/parent', 'repo::/child')
    expect(call).toHaveBeenCalledWith('git.mergeWinnerIntoParent', {
      parent: 'repo::/parent',
      winner: 'repo::/child'
    })
  })

  it('includes syncWorkingTree:true in the RPC params when requested', async () => {
    const call: RpcCaller = vi.fn(async () => frame({ outcome: 'clean', commitOid: 'c0ffee' }))
    const methods = createGitMergeMethods({ call })
    await methods.gitMergeWinnerIntoParent('repo::/parent', 'repo::/child', undefined, true)
    expect(call).toHaveBeenCalledWith('git.mergeWinnerIntoParent', {
      parent: 'repo::/parent',
      winner: 'repo::/child',
      syncWorkingTree: true
    })
  })

  it('omits syncWorkingTree from the RPC params when explicitly false', async () => {
    const call: RpcCaller = vi.fn(async () => frame({ outcome: 'clean', commitOid: 'c0ffee' }))
    const methods = createGitMergeMethods({ call })
    await methods.gitMergeWinnerIntoParent('repo::/parent', 'repo::/child', undefined, false)
    expect(call).toHaveBeenCalledWith('git.mergeWinnerIntoParent', {
      parent: 'repo::/parent',
      winner: 'repo::/child'
    })
  })

  it('projects a synced workingTree sub-shape', async () => {
    const call: RpcCaller = vi.fn(async () =>
      frame({ outcome: 'clean', commitOid: 'abc123', workingTree: { status: 'synced' } })
    )
    const methods = createGitMergeMethods({ call })
    await expect(methods.gitMergeWinnerIntoParent('p', 'w')).resolves.toEqual({
      outcome: 'clean',
      commitOid: 'abc123',
      workingTree: { status: 'synced' }
    })
  })

  it('projects the dependencySetup outcome, dropping a malformed one', async () => {
    const started: RpcCaller = vi.fn(async () =>
      frame({ outcome: 'clean', commitOid: 'abc123', dependencySetup: { status: 'started' } })
    )
    await expect(
      createGitMergeMethods({ call: started }).gitMergeWinnerIntoParent('p', 'w')
    ).resolves.toEqual({
      outcome: 'clean',
      commitOid: 'abc123',
      dependencySetup: { status: 'started' }
    })
    const bogus: RpcCaller = vi.fn(async () =>
      frame({ outcome: 'clean', commitOid: 'abc123', dependencySetup: { status: 'x' } })
    )
    await expect(
      createGitMergeMethods({ call: bogus }).gitMergeWinnerIntoParent('p', 'w')
    ).resolves.toEqual({
      outcome: 'clean',
      commitOid: 'abc123'
    })
  })

  it('projects a skipped/dirty workingTree sub-shape', async () => {
    const call: RpcCaller = vi.fn(async () =>
      frame({
        outcome: 'clean',
        commitOid: 'abc123',
        workingTree: { status: 'skipped', reason: 'dirty' }
      })
    )
    const methods = createGitMergeMethods({ call })
    await expect(methods.gitMergeWinnerIntoParent('p', 'w')).resolves.toEqual({
      outcome: 'clean',
      commitOid: 'abc123',
      workingTree: { status: 'skipped', reason: 'dirty' }
    })
  })

  it('projects a failed workingTree sub-shape with its message', async () => {
    const call: RpcCaller = vi.fn(async () =>
      frame({
        outcome: 'clean',
        commitOid: 'abc123',
        workingTree: { status: 'failed', message: 'refusing to clobber' }
      })
    )
    const methods = createGitMergeMethods({ call })
    await expect(methods.gitMergeWinnerIntoParent('p', 'w')).resolves.toEqual({
      outcome: 'clean',
      commitOid: 'abc123',
      workingTree: { status: 'failed', message: 'refusing to clobber' }
    })
  })

  it('drops a malformed workingTree instead of throwing on an otherwise-valid clean result', async () => {
    const call: RpcCaller = vi.fn(async () =>
      frame({ outcome: 'clean', commitOid: 'abc123', workingTree: { status: 'bogus' } })
    )
    const methods = createGitMergeMethods({ call })
    await expect(methods.gitMergeWinnerIntoParent('p', 'w')).resolves.toEqual({
      outcome: 'clean',
      commitOid: 'abc123'
    })
  })
})

describe('createGitMergeMethods — atomic sync outcomes', () => {
  const resolveWith = async (result: unknown) =>
    createGitMergeMethods({ call: vi.fn(async () => frame(result)) }).gitMergeWinnerIntoParent(
      'p',
      'w'
    )

  it('projects a blocked result with its reason, paths and detail', async () => {
    await expect(
      resolveWith({
        outcome: 'blocked',
        reason: 'untracked-overwrite',
        paths: ['new.txt'],
        message: 'error: x'
      })
    ).resolves.toEqual({
      outcome: 'blocked',
      reason: 'untracked-overwrite',
      paths: ['new.txt'],
      message: 'error: x'
    })
  })

  it('maps an unknown blocked reason from a newer host to sync-refused', async () => {
    await expect(
      resolveWith({ outcome: 'blocked', reason: 'future-reason', paths: [] })
    ).resolves.toEqual({ outcome: 'blocked', reason: 'sync-refused', paths: [] })
  })

  it('projects already-merged with the parent tip', async () => {
    await expect(resolveWith({ outcome: 'already-merged', commitOid: 'abc' })).resolves.toEqual({
      outcome: 'already-merged',
      commitOid: 'abc'
    })
  })

  it('keeps previousOid on a failed (merged-unsynced) workingTree', async () => {
    await expect(
      resolveWith({
        outcome: 'clean',
        commitOid: 'abc',
        workingTree: { status: 'failed', message: 'm', previousOid: 'prev' }
      })
    ).resolves.toEqual({
      outcome: 'clean',
      commitOid: 'abc',
      workingTree: { status: 'failed', message: 'm', previousOid: 'prev' }
    })
  })
})
