import type { WorktreeId } from '../domain/worktree-graph/types'
import type {
  DiffFileContent,
  MergeBlockReason,
  ParentDependencySetupResult,
  ParentWorkingTreeSyncResult
} from './ports/runtime-gateway'
import type { DiffFileRow } from './diff-view-model'
import { emptyCompareChildLoad, reduceCompareChildLoad } from './compare-child-load'
import type { CompareChildLoad, CompareChildLoadAction } from './compare-child-load'
import type { FailureMessage } from './i18n/user-facing-error'

export type { CompareChildLoad }

/** Winner-merge state (Change E) — idle until fired; headless, so `clean` never touches the
 *  parent worktree's working tree unless `workingTree` (v3-2, opt-in) reports otherwise. */
export type CompareMergeState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | {
      phase: 'clean'
      commitOid: string
      workingTree?: ParentWorkingTreeSyncResult
      dependencySetup?: ParentDependencySetupResult
    }
  | { phase: 'conflict'; files: readonly string[] }
  /** Synced merge refused up front: the parent ref did not move. */
  | { phase: 'blocked'; reason: MergeBlockReason; paths: readonly string[]; message?: string }
  | { phase: 'already-merged'; commitOid: string }
  | { phase: 'error'; message: FailureMessage }

const idleMerge = (): CompareMergeState => ({ phase: 'idle' })

/** closed → open (anchored to the running camada's litter, parent already dropped by the caller). */
export type CompareViewSlice =
  | { view: 'closed' }
  | {
      view: 'open'
      members: readonly WorktreeId[]
      focusedChildId: WorktreeId | null
      winnerId: WorktreeId | null
      merge: CompareMergeState
      childLoads: Record<WorktreeId, CompareChildLoad>
    }

export const emptyCompareViewSlice = (): CompareViewSlice => ({ view: 'closed' })

export type CompareViewAction =
  | { type: 'open'; members: readonly WorktreeId[] }
  | { type: 'members-added'; members: readonly WorktreeId[] }
  | { type: 'focus-child'; childId: WorktreeId }
  | { type: 'select-file'; childId: WorktreeId; path: string }
  | {
      type: 'child-rail-loaded'
      childId: WorktreeId
      compare: { headOid: string; mergeBase: string }
      files: readonly DiffFileRow[]
    }
  | { type: 'child-rail-error'; childId: WorktreeId; message?: FailureMessage }
  | { type: 'child-panel-loaded'; childId: WorktreeId; path: string; content: DiffFileContent }
  | { type: 'child-panel-error'; childId: WorktreeId; path: string; message?: FailureMessage }
  | { type: 'set-winner'; winnerId: WorktreeId | null }
  | { type: 'merge-start' }
  | {
      type: 'merge-clean'
      commitOid: string
      workingTree?: ParentWorkingTreeSyncResult
      dependencySetup?: ParentDependencySetupResult
    }
  | { type: 'merge-conflict'; files: readonly string[] }
  | {
      type: 'merge-blocked'
      reason: MergeBlockReason
      paths: readonly string[]
      message?: string
    }
  | { type: 'merge-already-merged'; commitOid: string }
  | { type: 'merge-error'; message: FailureMessage }
  | { type: 'merge-reset' }
  | { type: 'close' }

const isChildLoadAction = (action: CompareViewAction): action is CompareChildLoadAction =>
  action.type === 'select-file' ||
  action.type === 'child-rail-loaded' ||
  action.type === 'child-rail-error' ||
  action.type === 'child-panel-loaded' ||
  action.type === 'child-panel-error'

export function reduceCompareView(
  slice: CompareViewSlice,
  action: CompareViewAction
): CompareViewSlice {
  switch (action.type) {
    case 'open':
      return {
        view: 'open',
        members: action.members,
        focusedChildId: action.members[0] ?? null, // auto-focus (design D4)
        winnerId: null,
        merge: idleMerge(),
        childLoads: Object.fromEntries(
          action.members.map((childId) => [childId, emptyCompareChildLoad()])
        )
      }
    case 'close':
      return { view: 'closed' }
    case 'members-added': {
      if (slice.view !== 'open') return slice
      const fresh = action.members.filter((id) => !(id in slice.childLoads))
      if (fresh.length === 0) return slice
      return {
        ...slice,
        members: [...slice.members, ...fresh],
        focusedChildId: slice.focusedChildId ?? fresh[0] ?? null,
        childLoads: {
          ...slice.childLoads,
          ...Object.fromEntries(fresh.map((childId) => [childId, emptyCompareChildLoad()]))
        }
      }
    }
    case 'focus-child':
      return slice.view === 'open' ? { ...slice, focusedChildId: action.childId } : slice
    case 'set-winner':
      if (slice.view !== 'open' || slice.winnerId === action.winnerId) return slice
      // Why: a merge outcome describes the previous winner; keeping it would block a new merge.
      return {
        ...slice,
        winnerId: action.winnerId,
        merge: slice.merge.phase === 'running' ? slice.merge : idleMerge()
      }
    case 'merge-start':
      return slice.view === 'open' ? { ...slice, merge: { phase: 'running' } } : slice
    case 'merge-clean':
      return slice.view === 'open'
        ? {
            ...slice,
            merge: {
              phase: 'clean',
              commitOid: action.commitOid,
              ...(action.workingTree ? { workingTree: action.workingTree } : {}),
              ...(action.dependencySetup ? { dependencySetup: action.dependencySetup } : {})
            }
          }
        : slice
    case 'merge-conflict':
      return slice.view === 'open'
        ? { ...slice, merge: { phase: 'conflict', files: action.files } }
        : slice
    case 'merge-blocked': {
      if (slice.view !== 'open') return slice
      const { type: _type, ...blocked } = action
      return { ...slice, merge: { phase: 'blocked', ...blocked } }
    }
    case 'merge-already-merged':
      return slice.view === 'open'
        ? { ...slice, merge: { phase: 'already-merged', commitOid: action.commitOid } }
        : slice
    case 'merge-error':
      return slice.view === 'open'
        ? { ...slice, merge: { phase: 'error', message: action.message } }
        : slice
    case 'merge-reset':
      return slice.view === 'open' ? { ...slice, merge: idleMerge() } : slice
    default:
      if (slice.view !== 'open') return slice
      if (isChildLoadAction(action)) {
        const before = slice.childLoads[action.childId]
        if (!before) return slice
        const after = reduceCompareChildLoad(before, action)
        return after === before
          ? slice
          : { ...slice, childLoads: { ...slice.childLoads, [action.childId]: after } }
      }
      return slice
  }
}

/** ±1 over `members` in RAIL order, wrapping (design D5). A null focus enters at the first
 *  member going forward, the last going backward. A focus no longer in `members` (a removed
 *  child) resets to the first member. Empty members → null. */
export const stepCompareFocus = (
  members: readonly WorktreeId[],
  focusedChildId: WorktreeId | null,
  step: 1 | -1
): WorktreeId | null => {
  if (members.length === 0) return null
  if (focusedChildId === null) return step === 1 ? members[0]! : members[members.length - 1]!
  const index = members.indexOf(focusedChildId)
  if (index === -1) return members[0]!
  return members[(index + step + members.length) % members.length]!
}

/** The id the 3D selection ring follows: while compare is open the litter focus IS the
 *  selection (design D3) — a pure projection, never a store write. */
export const sceneSelectedId = (
  compareView: CompareViewSlice,
  selectedId: WorktreeId | null
): WorktreeId | null => (compareView.view === 'open' ? compareView.focusedChildId : selectedId)
