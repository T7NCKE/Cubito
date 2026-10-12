import { plainFailure } from './i18n/user-facing-error'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDiffLiveLoader } from './diff-live-loader'
import type { DiffLiveLoaderGatewayPort } from './diff-live-loader'
import { createSceneStore } from './scene-store'
import type { SceneStore } from './scene-store'
import type { BranchCompare, DiffFileContent, GitStatus } from './ports/runtime-gateway'
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

const workingTreeStatus = (overrides: Partial<GitStatus> = {}): GitStatus => ({
  entries: [],
  branch: 'main',
  branchLineTotal: 0,
  ...overrides
})

type FakeGateway = DiffLiveLoaderGatewayPort & {
  compareCalls: Array<{ worktree: string; baseRef: string }>
  statusCalls: string[]
  diffCalls: Array<{
    worktree: string
    compare: { mergeBase: string; headOid: string }
    filePath: string
    oldPath?: string
  }>
  workingTreeDiffCalls: Array<{ worktree: string; filePath: string }>
  gitBranchCompareImpl?: (worktree: string, baseRef: string) => Promise<BranchCompare>
  gitBranchDiffImpl?: (
    worktree: string,
    compare: { mergeBase: string; headOid: string },
    filePath: string,
    oldPath?: string
  ) => Promise<DiffFileContent>
  gitStatusImpl?: (worktree: string) => Promise<GitStatus>
  gitWorkingTreeDiffImpl?: (worktree: string, filePath: string) => Promise<DiffFileContent>
}

function createFakeGateway(): FakeGateway {
  const gw: FakeGateway = {
    compareCalls: [],
    statusCalls: [],
    diffCalls: [],
    workingTreeDiffCalls: [],
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
    },
    gitWorkingTreeDiff: async (worktree, filePath) => {
      gw.workingTreeDiffCalls.push({ worktree, filePath })
      if (gw.gitWorkingTreeDiffImpl) return gw.gitWorkingTreeDiffImpl(worktree, filePath)
      return {
        kind: 'text',
        originalContent: 'head',
        modifiedContent: 'worktree',
        truncated: false
      }
    },
    gitStatus: async (worktree) => {
      gw.statusCalls.push(worktree)
      if (gw.gitStatusImpl) return gw.gitStatusImpl(worktree)
      return workingTreeStatus()
    }
  }
  return gw
}

describe('createDiffLiveLoader', () => {
  let store: SceneStore

  const setupGraph = (): void => {
    const main = node({ id: 'repo::main', isMain: true, branch: 'refs/heads/main' })
    const child = node({
      id: 'repo::child',
      isMain: false,
      branch: 'refs/heads/child',
      parentId: 'repo::main'
    })
    store.update({ graph: graphOf([main, child]) })
  }

  beforeEach(() => {
    store = createSceneStore()
  })

  it('start(nodeId) resolves base ref, opens, then loads the rail from gitBranchCompare', async () => {
    setupGraph()
    const gateway = createFakeGateway()
    const loader = createDiffLiveLoader({ store, gateway })

    loader.start('repo::child')
    expect(store.get().diffView).toEqual(
      expect.objectContaining({ view: 'open', focusedNodeId: 'repo::child', status: 'loading' })
    )

    await vi.waitFor(() => expect(gateway.compareCalls.length).toBe(1))
    expect(gateway.compareCalls[0]).toEqual({ worktree: 'repo::child', baseRef: 'refs/heads/main' })

    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.status).toBe('ready')
    })
    const slice = store.get().diffView
    if (slice.view === 'open') {
      expect(slice.compare).toEqual({ headOid: 'head-oid', mergeBase: 'merge-base' })
      expect(slice.files).toEqual([
        { path: 'src/a.ts', status: 'modified', added: 3, removed: 1, origin: 'branch' }
      ])
    }
    loader.stop()
  })

  it('start(nodeId) with an unresolvable base ref dispatches open-error and never calls the gateway', async () => {
    const lonely = node({
      id: 'repo::lonely',
      isMain: false,
      branch: 'refs/heads/lonely',
      parentId: null,
      repoId: 'orphan-repo'
    })
    store.update({ graph: graphOf([lonely]) })
    const gateway = createFakeGateway()
    const loader = createDiffLiveLoader({ store, gateway })

    loader.start('repo::lonely')
    await vi.waitFor(() => {
      expect(store.get().diffView).toEqual({ view: 'closed' })
    })
    expect(gateway.compareCalls.length).toBe(0)
    expect(gateway.diffCalls.length).toBe(0)
    loader.stop()
  })

  it('dispatches rail-error when gitBranchCompare rejects', async () => {
    setupGraph()
    const gateway = createFakeGateway()
    gateway.gitBranchCompareImpl = () => Promise.reject(new Error('boom'))
    const loader = createDiffLiveLoader({ store, gateway })

    loader.start('repo::child')
    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.status).toBe('error')
    })
    const slice = store.get().diffView
    if (slice.view === 'open') {
      expect(slice.errorMessage).toEqual({
        lead: 'no se pudo comparar la rama con su base',
        detail: 'boom'
      })
    }
    loader.stop()
  })

  it('dispatches rail-error (not rail-loaded) when gitBranchCompare resolves with a non-ready status', async () => {
    setupGraph()
    const gateway = createFakeGateway()
    gateway.gitBranchCompareImpl = async () =>
      branchCompare({ status: 'no-merge-base', entries: [] })
    const loader = createDiffLiveLoader({ store, gateway })

    loader.start('repo::child')
    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.status).toBe('error')
    })
    const slice = store.get().diffView
    if (slice.view === 'open') {
      expect(slice.errorMessage).toEqual(plainFailure('sin ancestro común con la base'))
      expect(slice.files).toEqual([])
    }
    loader.stop()
  })

  it.each([
    ['invalid-base', 'base inválida'],
    ['unborn-head', 'rama sin commits'],
    ['no-merge-base', 'sin ancestro común con la base'],
    ['loading', 'loading']
  ])('maps branch-compare status %s to the human message %s', async (status, message) => {
    setupGraph()
    const gateway = createFakeGateway()
    gateway.gitBranchCompareImpl = async () => branchCompare({ status, entries: [] })
    const loader = createDiffLiveLoader({ store, gateway })

    loader.start('repo::child')
    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.status).toBe('error')
    })
    const slice = store.get().diffView
    if (slice.view === 'open') {
      expect(slice.errorMessage).toEqual(plainFailure(message))
    }
    loader.stop()
  })

  it('an empty entries list still dispatches rail-loaded, yielding the reducer empty state', async () => {
    setupGraph()
    const gateway = createFakeGateway()
    gateway.gitBranchCompareImpl = async () => branchCompare({ entries: [] })
    const loader = createDiffLiveLoader({ store, gateway })

    loader.start('repo::child')
    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.status).toBe('empty')
    })
    const slice = store.get().diffView
    if (slice.view === 'open') {
      expect(slice.files).toEqual([])
    }
    loader.stop()
  })

  it('lists a working-tree-only file when branchCompare returns ready with no entries (the reported bug)', async () => {
    setupGraph()
    const gateway = createFakeGateway()
    gateway.gitBranchCompareImpl = async () => branchCompare({ entries: [] })
    gateway.gitStatusImpl = async () =>
      workingTreeStatus({
        entries: [{ path: 'src/auth/auth.controller.ts', status: 'modified', added: 4, removed: 1 }]
      })
    const loader = createDiffLiveLoader({ store, gateway })

    loader.start('repo::child')
    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.status).toBe('ready')
    })
    const slice = store.get().diffView
    if (slice.view === 'open') {
      expect(slice.files).toEqual([
        {
          path: 'src/auth/auth.controller.ts',
          status: 'modified',
          added: 4,
          removed: 1,
          origin: 'working'
        }
      ])
    }
    loader.stop()
  })

  it("merges a path changed both on the branch and in the working tree into one row tagged 'both'", async () => {
    setupGraph()
    const gateway = createFakeGateway()
    gateway.gitBranchCompareImpl = async () =>
      branchCompare({
        entries: [{ path: 'src/a.ts', status: 'modified', added: 3, removed: 1 }]
      })
    gateway.gitStatusImpl = async () =>
      workingTreeStatus({
        entries: [{ path: 'src/a.ts', status: 'modified', added: 2, removed: 0 }]
      })
    const loader = createDiffLiveLoader({ store, gateway })

    loader.start('repo::child')
    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.status).toBe('ready')
    })
    const slice = store.get().diffView
    if (slice.view === 'open') {
      expect(slice.files).toEqual([
        { path: 'src/a.ts', status: 'modified', added: 5, removed: 1, origin: 'both' }
      ])
    }
    loader.stop()
  })

  it('keeps branch rows when gitStatus rejects (degrade, never throw)', async () => {
    setupGraph()
    const gateway = createFakeGateway()
    gateway.gitStatusImpl = () => Promise.reject(new Error('status boom'))
    const loader = createDiffLiveLoader({ store, gateway })

    loader.start('repo::child')
    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.status).toBe('ready')
    })
    const slice = store.get().diffView
    if (slice.view === 'open') {
      expect(slice.files).toEqual([
        { path: 'src/a.ts', status: 'modified', added: 3, removed: 1, origin: 'branch' }
      ])
    }
    loader.stop()
  })

  it('rail stays empty only when both sources are empty', async () => {
    setupGraph()
    const gateway = createFakeGateway()
    gateway.gitBranchCompareImpl = async () => branchCompare({ entries: [] })
    gateway.gitStatusImpl = async () => workingTreeStatus({ entries: [] })
    const loader = createDiffLiveLoader({ store, gateway })

    loader.start('repo::child')
    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.status).toBe('empty')
    })
    loader.stop()
  })

  it('a node change mid-flight does not clobber the newer open slice with the stale compare', async () => {
    setupGraph()
    const gate = deferred<BranchCompare>()
    const gateway = createFakeGateway()
    gateway.gitBranchCompareImpl = () => gate.promise
    const loader = createDiffLiveLoader({ store, gateway })

    loader.start('repo::child')
    await vi.waitFor(() => expect(gateway.compareCalls.length).toBe(1))

    // node changes mid-flight: close, then open a different node directly on the store
    store.dispatchDiffView({ type: 'open', nodeId: 'repo::main', baseRef: 'refs/heads/other' })

    gate.resolve(branchCompare())
    await Promise.resolve()
    await Promise.resolve()

    const slice = store.get().diffView
    // must remain anchored to repo::main, untouched by the stale repo::child resolution
    expect(slice.view === 'open' && slice.focusedNodeId).toBe('repo::main')
    if (slice.view === 'open') {
      expect(slice.status).toBe('loading')
    }
    loader.stop()
  })

  it('selects the first file once the rail loads so the panel shows it and j moves to the second', async () => {
    setupGraph()
    const gateway = createFakeGateway()
    gateway.gitBranchCompareImpl = async () =>
      branchCompare({
        entries: [
          { path: 'src/a.ts', status: 'modified', added: 3, removed: 1 },
          { path: 'src/b.ts', status: 'modified', added: 1, removed: 0 }
        ]
      })
    const loader = createDiffLiveLoader({ store, gateway })

    loader.start('repo::child')
    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.panel.kind).toBe('text')
    })
    const slice = store.get().diffView
    expect(slice.view === 'open' && slice.selectedPath).toBe('src/a.ts')
    expect(gateway.diffCalls.map((c) => c.filePath)).toEqual(['src/a.ts'])
    loader.stop()
  })

  it('select(path) dispatches select, then loads the panel via gitBranchDiff', async () => {
    setupGraph()
    const gateway = createFakeGateway()
    const loader = createDiffLiveLoader({ store, gateway })

    loader.start('repo::child')
    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.status).toBe('ready')
    })

    loader.select('src/a.ts')
    const midSlice = store.get().diffView
    expect(midSlice.view === 'open' && midSlice.panel).toEqual({ kind: 'loading' })

    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.panel.kind).toBe('text')
    })
    expect(gateway.diffCalls[0]).toEqual({
      worktree: 'repo::child',
      compare: { mergeBase: 'merge-base', headOid: 'head-oid' },
      filePath: 'src/a.ts'
    })
    const slice = store.get().diffView
    if (slice.view === 'open') {
      expect(slice.panel).toEqual({
        kind: 'text',
        originalContent: 'a',
        modifiedContent: 'b',
        truncated: false
      })
    }
    loader.stop()
  })

  it('selecting a working-tree-only file loads content via gitWorkingTreeDiff, not gitBranchDiff', async () => {
    setupGraph()
    const gateway = createFakeGateway()
    gateway.gitBranchCompareImpl = async () => branchCompare({ entries: [] })
    gateway.gitStatusImpl = async () =>
      workingTreeStatus({
        entries: [{ path: 'src/auth/auth.controller.ts', status: 'modified', added: 4, removed: 1 }]
      })
    const loader = createDiffLiveLoader({ store, gateway })

    loader.start('repo::child')
    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.status).toBe('ready')
    })
    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.panel.kind).toBe('text')
    })
    expect(gateway.workingTreeDiffCalls).toEqual([
      { worktree: 'repo::child', filePath: 'src/auth/auth.controller.ts' }
    ])
    expect(gateway.diffCalls.length).toBe(0)
    const slice = store.get().diffView
    if (slice.view === 'open') {
      expect(slice.panel).toEqual({
        kind: 'text',
        originalContent: 'head',
        modifiedContent: 'worktree',
        truncated: false
      })
    }
    loader.stop()
  })

  it("selecting a 'both' file composes the mergeBase→worktree content", async () => {
    setupGraph()
    const gateway = createFakeGateway()
    gateway.gitBranchCompareImpl = async () =>
      branchCompare({ entries: [{ path: 'src/a.ts', status: 'modified', added: 3, removed: 1 }] })
    gateway.gitStatusImpl = async () =>
      workingTreeStatus({
        entries: [{ path: 'src/a.ts', status: 'modified', added: 2, removed: 0 }]
      })
    gateway.gitBranchDiffImpl = async () => ({
      kind: 'text',
      originalContent: 'base\n',
      modifiedContent: 'branch-head\n',
      truncated: false
    })
    gateway.gitWorkingTreeDiffImpl = async () => ({
      kind: 'text',
      originalContent: 'head\n',
      modifiedContent: 'worktree\n',
      truncated: false
    })
    const loader = createDiffLiveLoader({ store, gateway })

    loader.start('repo::child')
    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.status).toBe('ready')
    })
    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.panel.kind).toBe('text')
    })
    expect(gateway.diffCalls.length).toBe(1)
    expect(gateway.workingTreeDiffCalls.length).toBe(1)
    const slice = store.get().diffView
    if (slice.view === 'open') {
      expect(slice.panel).toEqual({
        kind: 'text',
        originalContent: 'base\n',
        modifiedContent: 'worktree\n',
        truncated: false
      })
    }
    loader.stop()
  })

  it('select(path) on a renamed row passes its oldPath as the 4th gitBranchDiff arg', async () => {
    setupGraph()
    const gateway = createFakeGateway()
    gateway.gitBranchCompareImpl = async () =>
      branchCompare({
        entries: [{ path: 'b.ts', status: 'renamed', oldPath: 'a.ts', added: 1, removed: 0 }]
      })
    const loader = createDiffLiveLoader({ store, gateway })

    loader.start('repo::child')
    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.status).toBe('ready')
    })
    await vi.waitFor(() => expect(gateway.diffCalls.length).toBe(1))
    expect(gateway.diffCalls[0]).toEqual({
      worktree: 'repo::child',
      compare: { mergeBase: 'merge-base', headOid: 'head-oid' },
      filePath: 'b.ts',
      oldPath: 'a.ts'
    })
    loader.stop()
  })

  it('select(path) dispatches panel-error when gitBranchDiff rejects', async () => {
    setupGraph()
    const gateway = createFakeGateway()
    gateway.gitBranchDiffImpl = () => Promise.reject(new Error('nope'))
    const loader = createDiffLiveLoader({ store, gateway })

    loader.start('repo::child')
    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.status).toBe('ready')
    })
    loader.select('src/a.ts')
    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.panel.kind).toBe('error')
    })
    const slice = store.get().diffView
    if (slice.view === 'open' && slice.panel.kind === 'error') {
      expect(slice.panel.message).toEqual({ lead: 'falló la carga del diff', detail: 'nope' })
    }
    loader.stop()
  })

  it('a binary/truncated panel content flows through unchanged', async () => {
    setupGraph()
    const gateway = createFakeGateway()
    gateway.gitBranchDiffImpl = async () => ({ kind: 'binary', modifiedDeleted: true })
    const loader = createDiffLiveLoader({ store, gateway })

    loader.start('repo::child')
    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.status).toBe('ready')
    })
    loader.select('src/a.ts')
    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.panel.kind).toBe('binary')
    })
    const slice = store.get().diffView
    if (slice.view === 'open') {
      expect(slice.panel).toEqual({ kind: 'binary', modifiedDeleted: true })
    }
    loader.stop()
  })

  it('select(path) is a no-op when the rail has no compare yet (loading/error)', async () => {
    setupGraph()
    const gate = deferred<BranchCompare>()
    const gateway = createFakeGateway()
    gateway.gitBranchCompareImpl = () => gate.promise
    const loader = createDiffLiveLoader({ store, gateway })

    loader.start('repo::child')
    await vi.waitFor(() => expect(gateway.compareCalls.length).toBe(1))
    // still loading — compare is null
    loader.select('src/a.ts')
    await Promise.resolve()
    expect(gateway.diffCalls.length).toBe(0)
    const slice = store.get().diffView
    expect(slice.view === 'open' && slice.panel).toEqual({ kind: 'idle' })
    gate.resolve(branchCompare())
    loader.stop()
  })

  it('a stale select resolution does not clobber a newer selection', async () => {
    setupGraph()
    const gate = deferred<DiffFileContent>()
    const gateway = createFakeGateway()
    gateway.gitBranchDiffImpl = () => gate.promise
    const loader = createDiffLiveLoader({ store, gateway })

    loader.start('repo::child')
    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.status).toBe('ready')
    })
    await vi.waitFor(() => expect(gateway.diffCalls.length).toBe(1))
    // select a different path before the first resolves
    store.dispatchDiffView({ type: 'select', path: 'src/b.ts' })

    gate.resolve({ kind: 'text', originalContent: 'x', modifiedContent: 'y', truncated: false })
    await Promise.resolve()
    await Promise.resolve()

    const slice = store.get().diffView
    expect(slice.view === 'open' && slice.selectedPath).toBe('src/b.ts')
    if (slice.view === 'open') {
      expect(slice.panel).toEqual({ kind: 'loading' })
    }
    loader.stop()
  })

  it('stop() prevents any dispatch from an in-flight compare resolving after stop', async () => {
    setupGraph()
    const gate = deferred<BranchCompare>()
    const gateway = createFakeGateway()
    gateway.gitBranchCompareImpl = () => gate.promise
    const loader = createDiffLiveLoader({ store, gateway })

    loader.start('repo::child')
    await vi.waitFor(() => expect(gateway.compareCalls.length).toBe(1))
    loader.stop()
    const sliceBeforeResolve = store.get().diffView

    gate.resolve(branchCompare())
    await Promise.resolve()
    await Promise.resolve()

    expect(store.get().diffView).toEqual(sliceBeforeResolve)
  })

  it('rebindGateway swaps the gateway used for subsequent calls', async () => {
    setupGraph()
    const gatewayA = createFakeGateway()
    const gatewayB = createFakeGateway()
    const loader = createDiffLiveLoader({ store, gateway: gatewayA })

    loader.start('repo::child')
    await vi.waitFor(() => expect(gatewayA.compareCalls.length).toBe(1))
    await vi.waitFor(() => {
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.status).toBe('ready')
    })

    await vi.waitFor(() => expect(gatewayA.diffCalls.length).toBe(1)) // initial auto-select

    loader.rebindGateway(gatewayB)
    loader.select('src/a.ts')
    await vi.waitFor(() => expect(gatewayB.diffCalls.length).toBe(1))
    expect(gatewayA.diffCalls.length).toBe(1)
    loader.stop()
  })

  describe('refresh', () => {
    it('reloads the rail and keeps the selected file when it still exists', async () => {
      setupGraph()
      const gateway = createFakeGateway()
      gateway.gitBranchCompareImpl = async () =>
        branchCompare({
          entries: [
            { path: 'src/a.ts', status: 'modified', added: 1, removed: 0 },
            { path: 'src/b.ts', status: 'modified', added: 1, removed: 0 }
          ]
        })
      const loader = createDiffLiveLoader({ store, gateway })
      loader.start('repo::child')
      await vi.waitFor(() => expect(gateway.diffCalls.length).toBe(1))
      loader.select('src/b.ts')
      await vi.waitFor(() => expect(gateway.diffCalls.length).toBe(2))

      loader.refresh()
      await vi.waitFor(() => expect(gateway.compareCalls.length).toBe(2))
      await vi.waitFor(() => expect(gateway.diffCalls.length).toBe(3))
      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.selectedPath).toBe('src/b.ts')
      loader.stop()
    })

    it('falls back to the first file when the selected one disappeared', async () => {
      setupGraph()
      const gateway = createFakeGateway()
      const loader = createDiffLiveLoader({ store, gateway })
      loader.start('repo::child')
      await vi.waitFor(() => expect(gateway.diffCalls.length).toBe(1))
      gateway.gitBranchCompareImpl = async () =>
        branchCompare({ entries: [{ path: 'src/z.ts', status: 'modified', added: 1, removed: 0 }] })

      loader.refresh()
      await vi.waitFor(() => {
        const slice = store.get().diffView
        expect(slice.view === 'open' && slice.selectedPath).toBe('src/z.ts')
      })
      loader.stop()
    })

    it('is a no-op while closed', () => {
      setupGraph()
      const gateway = createFakeGateway()
      createDiffLiveLoader({ store, gateway }).refresh()
      expect(gateway.compareCalls.length).toBe(0)
    })
  })

  describe('live poll', () => {
    const twoFiles = (bAdded = 1): BranchCompare =>
      branchCompare({
        entries: [
          { path: 'src/a.ts', status: 'modified', added: 1, removed: 0 },
          { path: 'src/b.ts', status: 'modified', added: bAdded, removed: 0 }
        ]
      })

    const openOnSecondFile = async (gateway: FakeGateway) => {
      const loader = createDiffLiveLoader({ store, gateway, refreshIntervalMs: 0 })
      loader.start('repo::child')
      await vi.waitFor(() => expect(gateway.diffCalls.length).toBe(1))
      loader.select('src/b.ts')
      await vi.waitFor(() => {
        const slice = store.get().diffView
        expect(slice.view === 'open' && slice.panel.kind).toBe('text')
      })
      return loader
    }

    it('an unchanged tick leaves the slice and the panel untouched', async () => {
      setupGraph()
      const gateway = createFakeGateway()
      gateway.gitBranchCompareImpl = async () => twoFiles()
      const loader = await openOnSecondFile(gateway)
      const before = store.get().diffView

      loader.poll()
      await vi.waitFor(() => expect(gateway.compareCalls.length).toBe(2))
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(store.get().diffView).toBe(before)
      expect(gateway.diffCalls.length).toBe(2)
      loader.stop()
    })

    it('a changed rail updates in place, keeps the selection and never shows the loading panel', async () => {
      setupGraph()
      const gateway = createFakeGateway()
      gateway.gitBranchCompareImpl = async () => twoFiles()
      const loader = await openOnSecondFile(gateway)
      const panelKinds: string[] = []
      store.subscribe(() => {
        const slice = store.get().diffView
        if (slice.view === 'open') panelKinds.push(slice.panel.kind)
      })

      gateway.gitBranchCompareImpl = async () => twoFiles(7)
      loader.poll()
      await vi.waitFor(() => expect(gateway.diffCalls.length).toBe(3))
      await vi.waitFor(() => {
        const slice = store.get().diffView
        expect(slice.view === 'open' && slice.files[1]?.added).toBe(7)
      })

      const slice = store.get().diffView
      expect(slice.view === 'open' && slice.selectedPath).toBe('src/b.ts')
      expect(panelKinds).not.toContain('loading')
      loader.stop()
    })

    it('a failing tick keeps what is on screen', async () => {
      setupGraph()
      const gateway = createFakeGateway()
      gateway.gitBranchCompareImpl = async () => twoFiles()
      const loader = await openOnSecondFile(gateway)
      const before = store.get().diffView

      gateway.gitBranchCompareImpl = async () => {
        throw new Error('offline')
      }
      loader.poll()
      await vi.waitFor(() => expect(gateway.compareCalls.length).toBe(2))
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(store.get().diffView).toBe(before)
      loader.stop()
    })

    it('polls on the interval while open and stops polling after stop()', async () => {
      vi.useFakeTimers()
      try {
        setupGraph()
        const gateway = createFakeGateway()
        const loader = createDiffLiveLoader({ store, gateway, refreshIntervalMs: 1000 })
        loader.start('repo::child')
        await vi.advanceTimersByTimeAsync(10)
        const initial = gateway.compareCalls.length

        await vi.advanceTimersByTimeAsync(1000)
        expect(gateway.compareCalls.length).toBe(initial + 1)

        loader.stop()
        await vi.advanceTimersByTimeAsync(5000)
        expect(gateway.compareCalls.length).toBe(initial + 1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('invokes onPolled after each tick so source-control status can follow', async () => {
      setupGraph()
      const gateway = createFakeGateway()
      const onPolled = vi.fn()
      const loader = createDiffLiveLoader({ store, gateway, refreshIntervalMs: 0, onPolled })
      loader.start('repo::child')
      await vi.waitFor(() => expect(gateway.diffCalls.length).toBe(1))
      loader.poll()
      expect(onPolled).toHaveBeenCalledOnce()
      loader.stop()
    })
  })
})
