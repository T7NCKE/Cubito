import { plainFailure } from './i18n/user-facing-error'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCompareLiveLoader } from './compare-live-loader'
import type { CompareLiveLoaderGatewayPort } from './compare-live-loader'
import { createSceneStore } from './scene-store'
import type { SceneStore } from './scene-store'
import type { BranchCompare, DiffFileContent } from './ports/runtime-gateway'
import type { WorktreeGraph, WorktreeNode } from '../domain/worktree-graph/types'
import { emptyWorktreeGraph } from '../domain/worktree-graph/types'
import { inertActivity } from '../domain/worktree-graph/node-activity'

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const node = (overrides: Partial<WorktreeNode> = {}): WorktreeNode => ({
  id: 'repo::/path/main',
  repoId: 'repo',
  branch: 'refs/heads/main',
  path: '/path/main',
  status: 'in-progress',
  isMain: true,
  kind: 'root',
  parentId: null,
  childIds: [],
  activity: inertActivity(),
  ...overrides
})

const graphOf = (nodes: readonly WorktreeNode[]): WorktreeGraph => {
  const graph = emptyWorktreeGraph()
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return { ...graph, nodes: byId }
}

const branchCompare = (overrides: Partial<BranchCompare> = {}): BranchCompare => ({
  changedFiles: 1,
  commitsAhead: 1,
  commitsBehind: 0,
  baseRef: 'refs/heads/main',
  headOid: 'head-oid',
  mergeBase: 'merge-base',
  status: 'ready',
  entries: [{ path: 'src/a.ts', status: 'modified', added: 3, removed: 1 }],
  ...overrides
})

type FakeGateway = CompareLiveLoaderGatewayPort & {
  compareCalls: Array<{ worktree: string; baseRef: string }>
  diffCalls: Array<{
    worktree: string
    compare: { mergeBase: string; headOid: string }
    filePath: string
    oldPath?: string
  }>
  gitBranchCompareImpl?: (worktree: string, baseRef: string) => Promise<BranchCompare>
  gitBranchDiffImpl?: (
    worktree: string,
    compare: { mergeBase: string; headOid: string },
    filePath: string,
    oldPath?: string
  ) => Promise<DiffFileContent>
}

function createFakeGateway(): FakeGateway {
  const gw: FakeGateway = {
    compareCalls: [],
    diffCalls: [],
    gitBranchCompare: async (worktree, baseRef) => {
      gw.compareCalls.push({ worktree, baseRef })
      if (gw.gitBranchCompareImpl) return gw.gitBranchCompareImpl(worktree, baseRef)
      return branchCompare()
    },
    gitBranchDiff: async (worktree, compare, filePath, oldPath) => {
      gw.diffCalls.push({
        worktree,
        compare,
        filePath,
        ...(oldPath === undefined ? {} : { oldPath })
      })
      if (gw.gitBranchDiffImpl) return gw.gitBranchDiffImpl(worktree, compare, filePath, oldPath)
      return { kind: 'text', originalContent: 'a', modifiedContent: 'b', truncated: false }
    }
  }
  return gw
}

describe('createCompareLiveLoader', () => {
  let store: SceneStore

  const setupGraph = (): void => {
    const main = node({ id: 'repo::main', isMain: true, branch: 'refs/heads/main' })
    const childA = node({
      id: 'repo::child-a',
      isMain: false,
      branch: 'refs/heads/child-a',
      parentId: 'repo::main'
    })
    const childB = node({
      id: 'repo::child-b',
      isMain: false,
      branch: 'refs/heads/child-b',
      parentId: 'repo::main'
    })
    store.update({ graph: graphOf([main, childA, childB]) })
  }

  beforeEach(() => {
    store = createSceneStore()
  })

  it('start(members) resolves base ref and loads each child rail from gitBranchCompare, concurrently', async () => {
    setupGraph()
    store.dispatchCompareView({ type: 'open', members: ['repo::child-a', 'repo::child-b'] })
    const gateway = createFakeGateway()
    const loader = createCompareLiveLoader({ store, gateway })

    loader.start(['repo::child-a', 'repo::child-b'])
    await vi.waitFor(() => expect(gateway.compareCalls.length).toBe(2))
    expect(gateway.compareCalls).toEqual(
      expect.arrayContaining([
        { worktree: 'repo::child-a', baseRef: 'refs/heads/main' },
        { worktree: 'repo::child-b', baseRef: 'refs/heads/main' }
      ])
    )

    await vi.waitFor(() => {
      const slice = store.get().compareView
      expect(slice.view === 'open' && slice.childLoads['repo::child-a']?.status).toBe('ready')
      expect(slice.view === 'open' && slice.childLoads['repo::child-b']?.status).toBe('ready')
    })
    loader.stop()
  })

  it('a child with no resolvable base ref gets child-rail-error, without blocking the others (continue-on-error)', async () => {
    const main = node({ id: 'repo::main', isMain: true, branch: 'refs/heads/main' })
    const lonely = node({
      id: 'repo::lonely',
      isMain: false,
      branch: 'refs/heads/lonely',
      parentId: null,
      repoId: 'orphan-repo'
    })
    const childA = node({
      id: 'repo::child-a',
      isMain: false,
      branch: 'refs/heads/child-a',
      parentId: 'repo::main'
    })
    store.update({ graph: graphOf([main, lonely, childA]) })
    store.dispatchCompareView({ type: 'open', members: ['repo::lonely', 'repo::child-a'] })
    const gateway = createFakeGateway()
    const loader = createCompareLiveLoader({ store, gateway })

    loader.start(['repo::lonely', 'repo::child-a'])
    await vi.waitFor(() => {
      const slice = store.get().compareView
      expect(slice.view === 'open' && slice.childLoads['repo::lonely']?.status).toBe('error')
      expect(slice.view === 'open' && slice.childLoads['repo::child-a']?.status).toBe('ready')
    })
    expect(gateway.compareCalls).toEqual([
      { worktree: 'repo::child-a', baseRef: 'refs/heads/main' }
    ])
    const lonelyLoad = store.get().compareView
    expect(
      lonelyLoad.view === 'open' && lonelyLoad.childLoads['repo::lonely']?.errorMessage
    ).toEqual({ lead: 'no se pudo determinar contra qué rama comparar', detail: 'repo::lonely' })
    loader.stop()
  })

  describe('fresh fan-out child not yet in the graph', () => {
    const openFor = (parentId: string): void => {
      store.dispatchFanOut({ type: 'open-for-node', nodeId: parentId })
      store.dispatchFanOut({ type: 'set-repo-selector', repoSelector: 'id:repo' })
      store.dispatchFanOut({ type: 'submit', mutationIds: ['m1'] })
      store.dispatchCompareView({ type: 'open', members: ['repo::fresh'] })
    }
    const mainNode = node({ id: 'repo::main', isMain: true, branch: 'refs/heads/main' })
    const freshNode = node({
      id: 'repo::fresh',
      isMain: false,
      branch: 'refs/heads/fresh',
      parentId: 'repo::main'
    })
    const loadOf = () => {
      const slice = store.get().compareView
      return slice.view === 'open' ? slice.childLoads['repo::fresh'] : undefined
    }

    it('falls back to the fan-out parent branch instead of erroring', async () => {
      store.update({ graph: graphOf([mainNode]) })
      openFor('repo::main')
      const gateway = createFakeGateway()
      const loader = createCompareLiveLoader({ store, gateway })

      loader.start(['repo::fresh'])
      await vi.waitFor(() => expect(loadOf()?.status).toBe('ready'))
      expect(gateway.compareCalls).toEqual([
        { worktree: 'repo::fresh', baseRef: 'refs/heads/main' }
      ])
      loader.stop()
    })

    it('stays pending (no error) while nothing resolves, then loads once the node joins the graph', async () => {
      store.update({ graph: graphOf([]) })
      store.dispatchCompareView({ type: 'open', members: ['repo::fresh'] })
      const gateway = createFakeGateway()
      const loader = createCompareLiveLoader({ store, gateway })

      loader.start(['repo::fresh'])
      await Promise.resolve()
      expect(loadOf()?.status).toBe('loading')
      expect(gateway.compareCalls).toEqual([])

      store.update({ graph: graphOf([mainNode, freshNode]) })
      await vi.waitFor(() => expect(loadOf()?.status).toBe('ready'))
      expect(gateway.compareCalls).toEqual([
        { worktree: 'repo::fresh', baseRef: 'refs/heads/main' }
      ])
      loader.stop()
    })

    it('stop() cancels a pending retry', async () => {
      store.update({ graph: graphOf([]) })
      store.dispatchCompareView({ type: 'open', members: ['repo::fresh'] })
      const gateway = createFakeGateway()
      const loader = createCompareLiveLoader({ store, gateway })

      loader.start(['repo::fresh'])
      loader.stop()
      store.update({ graph: graphOf([mainNode, freshNode]) })
      await Promise.resolve()
      expect(gateway.compareCalls).toEqual([])
    })
  })

  it('dispatches child-rail-error when gitBranchCompare rejects for one child, isolated from the other', async () => {
    setupGraph()
    store.dispatchCompareView({ type: 'open', members: ['repo::child-a', 'repo::child-b'] })
    const gateway = createFakeGateway()
    gateway.gitBranchCompareImpl = async (worktree) => {
      if (worktree === 'repo::child-a') throw new Error('boom')
      return branchCompare()
    }
    const loader = createCompareLiveLoader({ store, gateway })

    loader.start(['repo::child-a', 'repo::child-b'])
    await vi.waitFor(() => {
      const slice = store.get().compareView
      expect(slice.view === 'open' && slice.childLoads['repo::child-a']?.status).toBe('error')
      expect(slice.view === 'open' && slice.childLoads['repo::child-b']?.status).toBe('ready')
    })
    const slice = store.get().compareView
    expect(slice.view === 'open' && slice.childLoads['repo::child-a']?.errorMessage).toEqual({
      lead: 'no se pudieron cargar los cambios de esta rama',
      detail: 'boom'
    })
    loader.stop()
  })

  it('dispatches child-rail-error (not child-rail-loaded) for a non-ready branch-compare status', async () => {
    setupGraph()
    store.dispatchCompareView({ type: 'open', members: ['repo::child-a'] })
    const gateway = createFakeGateway()
    gateway.gitBranchCompareImpl = async () =>
      branchCompare({ status: 'no-merge-base', entries: [] })
    const loader = createCompareLiveLoader({ store, gateway })

    loader.start(['repo::child-a'])
    await vi.waitFor(() => {
      const slice = store.get().compareView
      expect(slice.view === 'open' && slice.childLoads['repo::child-a']?.status).toBe('error')
    })
    const slice = store.get().compareView
    expect(slice.view === 'open' && slice.childLoads['repo::child-a']?.errorMessage).toEqual(
      plainFailure('sin ancestro común con la base')
    )
    loader.stop()
  })

  it('an empty entries list still dispatches child-rail-loaded, yielding the reducer empty state', async () => {
    setupGraph()
    store.dispatchCompareView({ type: 'open', members: ['repo::child-a'] })
    const gateway = createFakeGateway()
    gateway.gitBranchCompareImpl = async () => branchCompare({ entries: [] })
    const loader = createCompareLiveLoader({ store, gateway })

    loader.start(['repo::child-a'])
    await vi.waitFor(() => {
      const slice = store.get().compareView
      expect(slice.view === 'open' && slice.childLoads['repo::child-a']?.status).toBe('empty')
    })
    loader.stop()
  })

  it('closing (and reopening for a different litter) mid-flight does not clobber the newer state with a stale resolution', async () => {
    setupGraph()
    store.dispatchCompareView({ type: 'open', members: ['repo::child-a'] })
    const gate = deferred<BranchCompare>()
    const gateway = createFakeGateway()
    gateway.gitBranchCompareImpl = () => gate.promise
    const loader = createCompareLiveLoader({ store, gateway })

    loader.start(['repo::child-a'])
    await vi.waitFor(() => expect(gateway.compareCalls.length).toBe(1))

    // compare view closes mid-flight, directly on the store (not through the loader)
    store.dispatchCompareView({ type: 'close' })

    gate.resolve(branchCompare())
    await Promise.resolve()
    await Promise.resolve()

    expect(store.get().compareView).toEqual({ view: 'closed' })
    loader.stop()
  })

  it('select(childId, path) dispatches select-file scoped to that child, then loads its panel via gitBranchDiff', async () => {
    setupGraph()
    store.dispatchCompareView({ type: 'open', members: ['repo::child-a', 'repo::child-b'] })
    const gateway = createFakeGateway()
    const loader = createCompareLiveLoader({ store, gateway })

    loader.start(['repo::child-a', 'repo::child-b'])
    await vi.waitFor(() => {
      const slice = store.get().compareView
      expect(slice.view === 'open' && slice.childLoads['repo::child-a']?.status).toBe('ready')
    })

    loader.select('repo::child-a', 'src/a.ts')
    const midSlice = store.get().compareView
    expect(midSlice.view === 'open' && midSlice.childLoads['repo::child-a']?.panel).toEqual({
      kind: 'loading'
    })
    // the OTHER child's load is untouched by selecting on child-a
    expect(
      midSlice.view === 'open' && midSlice.childLoads['repo::child-b']?.selectedPath
    ).toBeNull()

    await vi.waitFor(() => {
      const slice = store.get().compareView
      expect(slice.view === 'open' && slice.childLoads['repo::child-a']?.panel.kind).toBe('text')
    })
    expect(gateway.diffCalls[0]).toEqual({
      worktree: 'repo::child-a',
      compare: { mergeBase: 'merge-base', headOid: 'head-oid' },
      filePath: 'src/a.ts'
    })
    loader.stop()
  })

  it('select(childId, path) dispatches child-panel-error when gitBranchDiff rejects', async () => {
    setupGraph()
    store.dispatchCompareView({ type: 'open', members: ['repo::child-a'] })
    const gateway = createFakeGateway()
    gateway.gitBranchDiffImpl = () => Promise.reject(new Error('nope'))
    const loader = createCompareLiveLoader({ store, gateway })

    loader.start(['repo::child-a'])
    await vi.waitFor(() => {
      const slice = store.get().compareView
      expect(slice.view === 'open' && slice.childLoads['repo::child-a']?.status).toBe('ready')
    })
    loader.select('repo::child-a', 'src/a.ts')
    await vi.waitFor(() => {
      const slice = store.get().compareView
      expect(slice.view === 'open' && slice.childLoads['repo::child-a']?.panel.kind).toBe('error')
    })
    const slice = store.get().compareView
    const panel = slice.view === 'open' ? slice.childLoads['repo::child-a']?.panel : undefined
    expect(panel).toMatchObject({
      kind: 'error',
      message: { lead: 'falló la carga del diff', detail: 'nope' }
    })
    loader.stop()
  })

  it('select(childId, path) is a no-op when that child rail has no compare yet', async () => {
    setupGraph()
    store.dispatchCompareView({ type: 'open', members: ['repo::child-a'] })
    const gate = deferred<BranchCompare>()
    const gateway = createFakeGateway()
    gateway.gitBranchCompareImpl = () => gate.promise
    const loader = createCompareLiveLoader({ store, gateway })

    loader.start(['repo::child-a'])
    await vi.waitFor(() => expect(gateway.compareCalls.length).toBe(1))
    loader.select('repo::child-a', 'src/a.ts')
    await Promise.resolve()
    expect(gateway.diffCalls.length).toBe(0)
    gate.resolve(branchCompare())
    loader.stop()
  })

  it('a stale select resolution for one child does not clobber a newer selection on that same child', async () => {
    setupGraph()
    store.dispatchCompareView({ type: 'open', members: ['repo::child-a'] })
    const gate = deferred<DiffFileContent>()
    const gateway = createFakeGateway()
    gateway.gitBranchDiffImpl = () => gate.promise
    const loader = createCompareLiveLoader({ store, gateway })

    loader.start(['repo::child-a'])
    await vi.waitFor(() => {
      const slice = store.get().compareView
      expect(slice.view === 'open' && slice.childLoads['repo::child-a']?.status).toBe('ready')
    })
    loader.select('repo::child-a', 'src/a.ts')
    await vi.waitFor(() => expect(gateway.diffCalls.length).toBe(1))
    store.dispatchCompareView({ type: 'select-file', childId: 'repo::child-a', path: 'src/b.ts' })

    gate.resolve({ kind: 'text', originalContent: 'x', modifiedContent: 'y', truncated: false })
    await Promise.resolve()
    await Promise.resolve()

    const slice = store.get().compareView
    const load = slice.view === 'open' ? slice.childLoads['repo::child-a'] : undefined
    expect(load?.selectedPath).toBe('src/b.ts')
    expect(load?.panel).toEqual({ kind: 'loading' })
    loader.stop()
  })

  it('stop() prevents any dispatch from an in-flight compare resolving after stop', async () => {
    setupGraph()
    store.dispatchCompareView({ type: 'open', members: ['repo::child-a'] })
    const gate = deferred<BranchCompare>()
    const gateway = createFakeGateway()
    gateway.gitBranchCompareImpl = () => gate.promise
    const loader = createCompareLiveLoader({ store, gateway })

    loader.start(['repo::child-a'])
    await vi.waitFor(() => expect(gateway.compareCalls.length).toBe(1))
    loader.stop()
    const sliceBeforeResolve = store.get().compareView

    gate.resolve(branchCompare())
    await Promise.resolve()
    await Promise.resolve()

    expect(store.get().compareView).toEqual(sliceBeforeResolve)
  })

  it('rebindGateway swaps the gateway used for subsequent calls', async () => {
    setupGraph()
    store.dispatchCompareView({ type: 'open', members: ['repo::child-a'] })
    const gatewayA = createFakeGateway()
    const gatewayB = createFakeGateway()
    const loader = createCompareLiveLoader({ store, gateway: gatewayA })

    loader.start(['repo::child-a'])
    await vi.waitFor(() => expect(gatewayA.compareCalls.length).toBe(1))
    await vi.waitFor(() => {
      const slice = store.get().compareView
      expect(slice.view === 'open' && slice.childLoads['repo::child-a']?.status).toBe('ready')
    })

    loader.rebindGateway(gatewayB)
    loader.select('repo::child-a', 'src/a.ts')
    await vi.waitFor(() => expect(gatewayB.diffCalls.length).toBe(1))
    expect(gatewayA.diffCalls.length).toBe(0)
    loader.stop()
  })

  describe('refresh while open', () => {
    const loadOf = (id: string) => {
      const slice = store.get().compareView
      return slice.view === 'open' ? slice.childLoads[id] : undefined
    }

    const startLoaded = async (gateway: FakeGateway) => {
      setupGraph()
      store.dispatchCompareView({ type: 'open', members: ['repo::child-a'] })
      const loader = createCompareLiveLoader({ store, gateway, refreshIntervalMs: 0 })
      loader.start(['repo::child-a'])
      await vi.waitFor(() => expect(loadOf('repo::child-a')?.status).toBe('ready'))
      return loader
    }

    it('re-loads the rail when the child head moved, keeping the selected file', async () => {
      const gateway = createFakeGateway()
      const loader = await startLoaded(gateway)
      loader.select('repo::child-a', 'src/a.ts')
      await vi.waitFor(() => expect(loadOf('repo::child-a')?.panel.kind).toBe('text'))
      gateway.gitBranchCompareImpl = async () =>
        branchCompare({
          headOid: 'head-2',
          entries: [
            { path: 'src/a.ts', status: 'modified', added: 9, removed: 1 },
            { path: 'src/b.ts', status: 'added', added: 4, removed: 0 }
          ]
        })
      loader.refresh()
      await vi.waitFor(() => expect(loadOf('repo::child-a')?.files).toHaveLength(2))
      expect(loadOf('repo::child-a')?.selectedPath).toBe('src/a.ts')
      expect(loadOf('repo::child-a')?.panel.kind).toBe('text') // no loading flash
      await vi.waitFor(() =>
        expect(gateway.diffCalls.at(-1)?.compare).toEqual({
          headOid: 'head-2',
          mergeBase: 'merge-base'
        })
      )
      loader.stop()
    })

    it('does not touch the store when nothing changed', async () => {
      const gateway = createFakeGateway()
      const loader = await startLoaded(gateway)
      const before = store.get().compareView
      loader.refresh()
      await vi.waitFor(() => expect(gateway.compareCalls).toHaveLength(2))
      await Promise.resolve()
      expect(store.get().compareView).toBe(before)
      loader.stop()
    })

    it('keeps the loaded rail when a refresh fails', async () => {
      const gateway = createFakeGateway()
      const loader = await startLoaded(gateway)
      gateway.gitBranchCompareImpl = async () => {
        throw new Error('boom')
      }
      loader.refresh()
      await vi.waitFor(() => expect(gateway.compareCalls).toHaveLength(2))
      await Promise.resolve()
      expect(loadOf('repo::child-a')?.status).toBe('ready')
      loader.stop()
    })

    it('polls on the interval while started and stops with the loader', async () => {
      vi.useFakeTimers()
      try {
        setupGraph()
        store.dispatchCompareView({ type: 'open', members: ['repo::child-a'] })
        const gateway = createFakeGateway()
        const loader = createCompareLiveLoader({ store, gateway, refreshIntervalMs: 1000 })
        loader.start(['repo::child-a'])
        await vi.advanceTimersByTimeAsync(0)
        expect(gateway.compareCalls).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1000)
        expect(gateway.compareCalls).toHaveLength(2)
        loader.stop()
        await vi.advanceTimersByTimeAsync(5000)
        expect(gateway.compareCalls).toHaveLength(2)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
