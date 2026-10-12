import { describe, expect, it, vi } from 'vitest'
import { runCompareMerge } from './compare-merge-run'
import type { CompareViewAction, CompareViewSlice } from './compare-view-model'
import { emptyCompareViewSlice, reduceCompareView } from './compare-view-model'
import type { FanOutSlice } from './fan-out-model'
import { emptyFanOutSlice } from './fan-out-model'
import type { WorktreeGraph } from '../domain/worktree-graph/types'
import type { MergeWinnerResult } from './ports/runtime-gateway'

const openWithWinner = (winnerId: string | null = 'w-child-2'): CompareViewSlice => {
  let slice = reduceCompareView(emptyCompareViewSlice(), {
    type: 'open',
    members: ['w-child-1', 'w-child-2']
  })
  slice = reduceCompareView(slice, { type: 'set-winner', winnerId })
  return slice
}

const runningFanOut = (parentId = 'w-parent'): FanOutSlice => ({
  view: 'running',
  parentId,
  fields: { count: 2, agent: 'claude', prompt: '' },
  repoSelector: null,
  batch: [],
  memberStatus: {},
  runId: null
})

const createFakeGateway = (impl?: () => Promise<MergeWinnerResult>) => ({
  gitMergeWinnerIntoParent: vi.fn(
    impl ?? (async () => ({ outcome: 'clean' as const, commitOid: 'abc123' }))
  )
})

const setup = (gateway = createFakeGateway()) => {
  const dispatch = vi.fn<(action: CompareViewAction) => void>()
  return { gateway, dispatch }
}

describe('runCompareMerge — no fan-out in this tab (reload / new tab)', () => {
  const graphWithParent = (parentId: string | null): WorktreeGraph =>
    ({
      nodes: new Map([['w-child-2', { id: 'w-child-2', parentId }]])
    }) as unknown as WorktreeGraph

  it("falls back to the winner's parent in the graph", async () => {
    const { gateway, dispatch } = setup()
    await runCompareMerge(openWithWinner('w-child-2'), emptyFanOutSlice(), {
      gateway,
      dispatch,
      graph: graphWithParent('w-graph-parent')
    })
    expect(gateway.gitMergeWinnerIntoParent).toHaveBeenCalledWith(
      'w-graph-parent',
      'w-child-2',
      undefined,
      false
    )
  })

  it('stays a no-op when the graph knows no parent either', async () => {
    const { gateway, dispatch } = setup()
    await runCompareMerge(openWithWinner('w-child-2'), emptyFanOutSlice(), {
      gateway,
      dispatch,
      graph: graphWithParent(null)
    })
    expect(gateway.gitMergeWinnerIntoParent).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('runCompareMerge — happy path', () => {
  it('calls gitMergeWinnerIntoParent with (parent, winner) — parent is fanOutMemberIds[0]', async () => {
    const { gateway, dispatch } = setup()
    await runCompareMerge(openWithWinner('w-child-2'), runningFanOut('w-parent'), {
      gateway,
      dispatch
    })
    expect(gateway.gitMergeWinnerIntoParent).toHaveBeenCalledWith(
      'w-parent',
      'w-child-2',
      undefined,
      false
    )
  })

  it('forwards syncWorkingTree true to the gateway when requested', async () => {
    const { gateway, dispatch } = setup()
    await runCompareMerge(
      openWithWinner('w-child-2'),
      runningFanOut('w-parent'),
      { gateway, dispatch },
      true
    )
    expect(gateway.gitMergeWinnerIntoParent).toHaveBeenCalledWith(
      'w-parent',
      'w-child-2',
      undefined,
      true
    )
  })

  it('dispatches merge-start, then merge-clean on a clean outcome', async () => {
    const { gateway, dispatch } = setup()
    await runCompareMerge(openWithWinner(), runningFanOut(), { gateway, dispatch })
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual([
      { type: 'merge-start' },
      { type: 'merge-clean', commitOid: 'abc123' }
    ])
  })

  it('threads result.workingTree into the dispatched merge-clean action', async () => {
    const gateway = createFakeGateway(async () => ({
      outcome: 'clean',
      commitOid: 'abc123',
      workingTree: { status: 'synced' }
    }))
    const { dispatch } = setup(gateway)
    await runCompareMerge(openWithWinner(), runningFanOut(), { gateway, dispatch }, true)
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'merge-clean',
      commitOid: 'abc123',
      workingTree: { status: 'synced' }
    })
  })

  it('threads result.dependencySetup into the dispatched merge-clean action', async () => {
    const gateway = createFakeGateway(async () => ({
      outcome: 'clean',
      commitOid: 'abc123',
      dependencySetup: { status: 'started' }
    }))
    const { dispatch } = setup(gateway)
    await runCompareMerge(openWithWinner(), runningFanOut(), { gateway, dispatch }, true)
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'merge-clean',
      commitOid: 'abc123',
      dependencySetup: { status: 'started' }
    })
  })

  it('dispatches merge-conflict with the file list on a conflict outcome', async () => {
    const gateway = createFakeGateway(async () => ({
      outcome: 'conflict',
      files: ['src/a.ts', 'src/b.ts']
    }))
    const { dispatch } = setup(gateway)
    await runCompareMerge(openWithWinner(), runningFanOut(), { gateway, dispatch })
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'merge-conflict',
      files: ['src/a.ts', 'src/b.ts']
    })
  })
})

describe('runCompareMerge — error branch', () => {
  it('dispatches merge-error with the thrown message, resilient to gateway rejection', async () => {
    const gateway = createFakeGateway()
    gateway.gitMergeWinnerIntoParent.mockRejectedValueOnce(new Error('host unavailable'))
    const { dispatch } = setup(gateway)
    await runCompareMerge(openWithWinner(), runningFanOut(), { gateway, dispatch })
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'merge-error',
      message: { lead: 'no se pudo mergear al ganador', detail: 'host unavailable' }
    })
  })

  it('stringifies a non-Error rejection', async () => {
    const gateway = createFakeGateway()
    gateway.gitMergeWinnerIntoParent.mockRejectedValueOnce('boom')
    const { dispatch } = setup(gateway)
    await runCompareMerge(openWithWinner(), runningFanOut(), { gateway, dispatch })
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'merge-error',
      message: { lead: 'no se pudo mergear al ganador', detail: 'boom' }
    })
  })
})

describe('runCompareMerge — guards (no-op, zero gateway calls)', () => {
  it('is a no-op when compare view is closed', async () => {
    const { gateway, dispatch } = setup()
    await runCompareMerge(emptyCompareViewSlice(), runningFanOut(), { gateway, dispatch })
    expect(gateway.gitMergeWinnerIntoParent).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('is a no-op when no winner is picked', async () => {
    const { gateway, dispatch } = setup()
    await runCompareMerge(openWithWinner(null), runningFanOut(), { gateway, dispatch })
    expect(gateway.gitMergeWinnerIntoParent).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('is a no-op when a merge is already running', async () => {
    const { gateway, dispatch } = setup()
    const running = reduceCompareView(openWithWinner(), { type: 'merge-start' })
    await runCompareMerge(running, runningFanOut(), { gateway, dispatch })
    expect(gateway.gitMergeWinnerIntoParent).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('is a no-op when fan-out has no members (closed litter)', async () => {
    const { gateway, dispatch } = setup()
    const closedFanOut: FanOutSlice = { view: 'closed', repoSelector: null }
    await runCompareMerge(openWithWinner(), closedFanOut, { gateway, dispatch })
    expect(gateway.gitMergeWinnerIntoParent).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('runCompareMerge — atomic sync outcomes', () => {
  it('dispatches merge-blocked with reason, paths and detail', async () => {
    const gateway = createFakeGateway(async () => ({
      outcome: 'blocked',
      reason: 'untracked-overwrite',
      paths: ['new.txt'],
      message: 'error: x'
    }))
    const { dispatch } = setup(gateway)
    await runCompareMerge(openWithWinner(), runningFanOut(), { gateway, dispatch }, true)
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'merge-blocked',
      reason: 'untracked-overwrite',
      paths: ['new.txt'],
      message: 'error: x'
    })
  })

  it('dispatches merge-already-merged with the parent tip', async () => {
    const gateway = createFakeGateway(async () => ({ outcome: 'already-merged', commitOid: 'abc' }))
    const { dispatch } = setup(gateway)
    await runCompareMerge(openWithWinner(), runningFanOut(), { gateway, dispatch })
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'merge-already-merged', commitOid: 'abc' })
  })
})
