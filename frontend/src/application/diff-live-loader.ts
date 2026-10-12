import { resolveBaseRef } from '../domain/worktree-graph/resolve-base-ref'
import type { WorktreeId } from '../domain/worktree-graph/types'
import { fetchBranchCompareEntries } from './branch-compare-entries-fetch'
import { fetchWorkingTreeEntries } from './working-tree-entries-fetch'
import { mergeFileDiffEntriesWithOrigin, type FileDiffOrigin } from './system-graph-file-diff'
import { composeBaseToWorkingTree } from './diff-panel-content-compose'
import type { DiffFileRow } from './diff-view-model'
import type { DiffFileContent, RuntimeGateway } from './ports/runtime-gateway'
import type { SceneStore } from './scene-store'
import { t } from './i18n/translate'
import { describeFailure, plainFailure } from './i18n/user-facing-error'

/** Only the methods diff mode needs — narrow like the other controller ports. */
export type DiffLiveLoaderGatewayPort = Pick<
  RuntimeGateway,
  'gitBranchCompare' | 'gitBranchDiff' | 'gitStatus' | 'gitWorkingTreeDiff'
>

export type DiffLiveLoaderDeps = {
  store: SceneStore
  gateway: DiffLiveLoaderGatewayPort
  /** Poll period while open; 0 disables (tests). */
  refreshIntervalMs?: number
  /** Runs after every poll tick (source-control status follows the same cadence). */
  onPolled?: () => void
}

export type DiffLiveLoader = {
  start(nodeId: string): void
  select(path: string): void
  /** Reloads the rail in place (after stage/commit); keeps the selection when the file survives. */
  refresh(): void
  /** Silent re-read: updates only what changed, never flashes loading and keeps the selection. */
  poll(): void
  stop(): void
  rebindGateway(gateway: DiffLiveLoaderGatewayPort): void
}

/**
 * Opens diff mode for a node, loads the rail via `gitBranchCompare`, and loads a file's
 * before/after content via `gitBranchDiff` on selection. No scripted arc — real gateway calls,
 * guarded against stale resolutions the way camada-member-poll re-checks the store post-await.
 */
const DEFAULT_REFRESH_INTERVAL_MS = 3000

export function createDiffLiveLoader(deps: DiffLiveLoaderDeps): DiffLiveLoader {
  let gateway = deps.gateway
  let stopped = true
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let polling = false
  const refreshIntervalMs = deps.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS

  function dispatch(action: Parameters<SceneStore['dispatchDiffView']>[0]): void {
    if (stopped) return
    deps.store.dispatchDiffView(action)
  }

  async function loadRail(nodeId: WorktreeId, keepSelection = false): Promise<void> {
    // Joined with git.status (working tree) so uncommitted changes show up alongside branch
    // ones — see design sdd/diff-working-tree. Both fetches run concurrently either way.
    const [result, workingResult] = await Promise.all([
      fetchBranchCompareEntries(gateway, deps.store.get().graph, nodeId),
      fetchWorkingTreeEntries(gateway, nodeId)
    ])
    if (stopped) return
    const slice = deps.store.get().diffView
    if (slice.view !== 'open' || slice.focusedNodeId !== nodeId) return // stale — node changed mid-flight
    switch (result.outcome) {
      case 'ready': {
        const merged = toRows(result, workingResult)
        dispatch({ type: 'rail-loaded', compare: result.compare, files: merged })
        // Why: without an initial selection the first j would land on row 0 instead of moving.
        const kept = keepSelection
          ? merged.find((entry) => entry.path === slice.selectedPath)
          : undefined
        if (merged.length > 0) select((kept ?? merged[0]!).path)
        return
      }
      case 'not-ready':
        dispatch({ type: 'rail-error', message: plainFailure(railErrorMessageFor(result.status)) })
        return
      case 'failed':
        dispatch({ type: 'rail-error', message: result.message })
        return
      case 'no-base-ref':
        return // unreachable — start() already resolved a baseRef before calling loadRail
    }
  }

  const toRows = (
    result: Extract<Awaited<ReturnType<typeof fetchBranchCompareEntries>>, { outcome: 'ready' }>,
    workingResult: Awaited<ReturnType<typeof fetchWorkingTreeEntries>>
  ): DiffFileRow[] => {
    // gitStatus rejecting degrades to branch-only rows — never throws the whole rail away.
    const working = workingResult.outcome === 'ready' ? workingResult.entries : null
    return (mergeFileDiffEntriesWithOrigin(result.entries, working) ?? []).map((entry) => ({
      path: entry.path,
      status: entry.status,
      added: entry.added,
      removed: entry.removed,
      origin: entry.origin,
      ...(entry.oldPath === undefined ? {} : { oldPath: entry.oldPath })
    }))
  }

  const sameRows = (a: readonly DiffFileRow[], b: readonly DiffFileRow[]): boolean =>
    a.length === b.length && a.every((row, i) => JSON.stringify(row) === JSON.stringify(b[i]))

  // Why: a poll must never flash 'loading' or an error over a rail the user is reading.
  async function pollRail(nodeId: WorktreeId): Promise<void> {
    try {
      const [result, workingResult] = await Promise.all([
        fetchBranchCompareEntries(gateway, deps.store.get().graph, nodeId),
        fetchWorkingTreeEntries(gateway, nodeId)
      ])
      if (stopped || result.outcome !== 'ready') return
      const slice = deps.store.get().diffView
      if (slice.view !== 'open' || slice.focusedNodeId !== nodeId || slice.compare === null) return
      const rows = toRows(result, workingResult)
      const sameRef =
        slice.compare.headOid === result.compare.headOid &&
        slice.compare.mergeBase === result.compare.mergeBase
      if (sameRef && sameRows(slice.files, rows)) return
      dispatch({ type: 'rail-loaded', compare: result.compare, files: rows })
      const selected = rows.find((row) => row.path === slice.selectedPath)
      if (selected === undefined) {
        if (rows.length > 0) select(rows[0]!.path)
        return
      }
      const before = slice.files.find((row) => row.path === selected.path)
      if (!sameRef || before === undefined || JSON.stringify(before) !== JSON.stringify(selected)) {
        void loadPanel(nodeId, selected.path, result.compare, selected.oldPath, selected.origin)
      }
    } catch {
      // keep what is on screen; the next tick retries
    }
  }

  function poll(): void {
    const slice = deps.store.get().diffView
    if (stopped || polling || slice.view !== 'open' || slice.compare === null) return
    polling = true
    deps.onPolled?.()
    void pollRail(slice.focusedNodeId).finally(() => {
      polling = false
    })
  }

  function stopPollTimer(): void {
    if (pollTimer !== null) clearInterval(pollTimer)
    pollTimer = null
  }

  /** Routes by origin: 'branch' is today's path unchanged; 'working' has no branch delta to
   *  diff against; 'both' composes mergeBase→worktree from the two existing RPCs. */
  async function contentFor(
    nodeId: WorktreeId,
    path: string,
    compare: DiffCompareRef,
    oldPath: string | undefined,
    origin: FileDiffOrigin | undefined
  ): Promise<DiffFileContent> {
    if (origin === 'working') {
      return gateway.gitWorkingTreeDiff(nodeId, path)
    }
    if (origin === 'both') {
      const [branchContent, workingContent] = await Promise.all([
        gateway.gitBranchDiff(nodeId, compare, path, oldPath),
        gateway.gitWorkingTreeDiff(nodeId, path)
      ])
      return composeBaseToWorkingTree(branchContent, workingContent)
    }
    return gateway.gitBranchDiff(nodeId, compare, path, oldPath)
  }

  async function loadPanel(
    nodeId: WorktreeId,
    path: string,
    compare: DiffCompareRef,
    oldPath: string | undefined,
    origin: FileDiffOrigin | undefined
  ): Promise<void> {
    try {
      const content = await contentFor(nodeId, path, compare, oldPath, origin)
      if (stopped) return
      const slice = deps.store.get().diffView
      if (slice.view !== 'open' || slice.focusedNodeId !== nodeId || slice.selectedPath !== path)
        return
      dispatch({ type: 'panel-loaded', path, content })
    } catch (error) {
      if (stopped) return
      const slice = deps.store.get().diffView
      if (slice.view !== 'open' || slice.focusedNodeId !== nodeId || slice.selectedPath !== path)
        return
      dispatch({ type: 'panel-error', path, message: describeFailure('diffPanel', error) })
    }
  }

  function select(path: string): void {
    const slice = deps.store.get().diffView
    if (slice.view !== 'open' || slice.compare === null) return // rail not loaded — no-op
    const nodeId = slice.focusedNodeId
    const compare = slice.compare
    const file = slice.files.find((f) => f.path === path)
    dispatch({ type: 'select', path })
    void loadPanel(nodeId, path, compare, file?.oldPath, file?.origin)
  }

  return {
    start(nodeId) {
      stopped = false
      const baseRef = resolveBaseRef(deps.store.get().graph, nodeId)
      if (baseRef === null) {
        dispatch({ type: 'open-error', message: { lead: t('diff.noBaseRef'), detail: nodeId } })
        return
      }
      dispatch({ type: 'open', nodeId, baseRef })
      void loadRail(nodeId)
      stopPollTimer()
      if (refreshIntervalMs > 0) pollTimer = setInterval(poll, refreshIntervalMs)
    },
    select,
    refresh() {
      const slice = deps.store.get().diffView
      if (stopped || slice.view !== 'open' || slice.compare === null) return
      void loadRail(slice.focusedNodeId, true)
    },
    poll,
    stop() {
      stopped = true
      stopPollTimer()
    },
    rebindGateway(newGateway) {
      gateway = newGateway
    }
  }
}

type DiffCompareRef = { mergeBase: string; headOid: string }

/** Human copy for a non-'ready' BranchCompare status (git.branchCompare doesn't throw for these).
 *  Exported for compare-live-loader.ts (Change D) — reused verbatim, one wording for both modes. */
export function railErrorMessageFor(status: string): string {
  switch (status) {
    case 'invalid-base':
      return t('diff.baseInvalid')
    case 'unborn-head':
      return t('diff.unbornHead')
    case 'no-merge-base':
      return t('diff.noMergeBase')
    default:
      return status
  }
}
