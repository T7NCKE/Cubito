import { inertActivity, type AgentStatus } from '../domain/worktree-graph/node-activity'
import type { WorktreeGraph, WorktreeId, WorktreeNode } from '../domain/worktree-graph/types'
import type {
  CreateWorktreeInput,
  LeaseGateRow,
  LeaseQuestionRow,
  SpawnAgent,
  WorkerDispatchStateRow
} from './ports/runtime-gateway'
import {
  decisionVisibilityCounts,
  emptyDecisionVisibility,
  withGates,
  withQuestions,
  type DecisionVisibility
} from './fan-out-decision-visibility'
import { t } from './i18n/translate'
import { plainFailure } from './i18n/user-facing-error'
import type { FailureMessage } from './i18n/user-facing-error'

export const MIN_FANOUT = 2
export const MAX_FANOUT = 8
const DEFAULT_FANOUT_COUNT = 3

/** Marks a graph node as a fan-out-in-flight placeholder, not a real worktree yet. */
export const FANOUT_PLACEHOLDER_PREFIX = 'fanout:'

export type FanOutFormFields = {
  count: number
  agent: SpawnAgent
  prompt: string
}

/** One requested child in the batch: pending until `worktreeId` arrives, or `failed`.
 *  `dispatchId`/`taskId` arrive only on the lease-run path (Change B); null on v1. */
export type FanOutBatchEntry = {
  mutationId: string
  worktreeId: WorktreeId | null
  failed: boolean
  dispatchId: string | null
  taskId: string | null
  /** Present only when the failing call reported a real message (`child-failed`'s `message`). */
  errorMessage?: FailureMessage
}

/** closed → form (anchored to a node) → running (batch in flight) → closed. */
export type FanOutSlice =
  | { view: 'closed'; repoSelector: string | null }
  | {
      view: 'form'
      parentId: WorktreeId
      fields: FanOutFormFields
      repoSelector: string | null
      errorMessage?: FailureMessage
    }
  | {
      view: 'running'
      parentId: WorktreeId
      fields: FanOutFormFields
      repoSelector: string | null
      batch: readonly FanOutBatchEntry[]
      memberStatus: Record<WorktreeId, AgentStatus>
      /** The lease Run backing this batch (Change B); null on the v1 worktree-only path. */
      runId: string | null
      /** Optional (Change C-EXTENDED): absent until the first `gates-updated`/`questions-updated`
       *  dispatch — old running-slice literals stay valid. Read via `fanOutDecisionCounts`. */
      decisionVisibility?: DecisionVisibility
    }

export const emptyFanOutSlice = (): FanOutSlice => ({ view: 'closed', repoSelector: null })

export type FanOutAction =
  | { type: 'open-for-node'; nodeId: WorktreeId }
  | { type: 'update-count'; count: number }
  | { type: 'update-agent'; agent: SpawnAgent }
  | { type: 'update-prompt'; prompt: string }
  | { type: 'set-repo-selector'; repoSelector: string }
  | { type: 'submit'; mutationIds: readonly string[] }
  | { type: 'form-error'; message: FailureMessage }
  | { type: 'child-created'; mutationId: string; worktreeId: WorktreeId }
  | { type: 'child-failed'; mutationId: string; message?: FailureMessage }
  | { type: 'member-status'; worktreeId: WorktreeId; status: AgentStatus }
  | { type: 'run-created'; runId: string }
  | { type: 'child-dispatched'; mutationId: string; dispatchId: string; taskId: string }
  | { type: 'gates-updated'; gates: readonly LeaseGateRow[] }
  | { type: 'questions-updated'; questions: readonly LeaseQuestionRow[] }
  | { type: 'cancel' }
  | { type: 'close' }

export const clampFanOutCount = (count: number): number =>
  Math.min(MAX_FANOUT, Math.max(MIN_FANOUT, count))

export function reduceFanOut(slice: FanOutSlice, action: FanOutAction): FanOutSlice {
  switch (action.type) {
    case 'open-for-node':
      return openForm(slice, action.nodeId)
    case 'update-count':
      return slice.view === 'form'
        ? { ...slice, fields: { ...slice.fields, count: clampFanOutCount(action.count) } }
        : slice
    case 'update-agent':
      return slice.view === 'form'
        ? { ...slice, fields: { ...slice.fields, agent: action.agent } }
        : slice
    case 'update-prompt':
      return slice.view === 'form'
        ? { ...slice, fields: { ...slice.fields, prompt: action.prompt } }
        : slice
    case 'set-repo-selector':
      return slice.view === 'closed' ? slice : { ...slice, repoSelector: action.repoSelector }
    case 'submit':
      return startSubmit(slice, action.mutationIds)
    case 'form-error':
      return slice.view === 'form' ? { ...slice, errorMessage: action.message } : slice
    case 'child-created':
      return slice.view === 'running'
        ? {
            ...slice,
            batch: withEntry(slice.batch, action.mutationId, (e) => ({
              ...e,
              worktreeId: action.worktreeId
            }))
          }
        : slice
    case 'child-failed':
      return slice.view === 'running'
        ? {
            ...slice,
            batch: withEntry(slice.batch, action.mutationId, (e) => ({
              ...e,
              failed: true,
              ...(action.message === undefined ? {} : { errorMessage: action.message })
            }))
          }
        : slice
    case 'member-status':
      return slice.view === 'running'
        ? { ...slice, memberStatus: { ...slice.memberStatus, [action.worktreeId]: action.status } }
        : slice
    case 'run-created':
      return slice.view === 'running' ? { ...slice, runId: action.runId } : slice
    case 'gates-updated':
      return slice.view === 'running'
        ? {
            ...slice,
            decisionVisibility: withGates(
              slice.decisionVisibility ?? emptyDecisionVisibility(),
              action.gates
            )
          }
        : slice
    case 'questions-updated':
      return slice.view === 'running'
        ? {
            ...slice,
            decisionVisibility: withQuestions(
              slice.decisionVisibility ?? emptyDecisionVisibility(),
              action.questions
            )
          }
        : slice
    case 'child-dispatched':
      return slice.view === 'running'
        ? {
            ...slice,
            batch: withEntry(slice.batch, action.mutationId, (e) => ({
              ...e,
              dispatchId: action.dispatchId,
              taskId: action.taskId
            }))
          }
        : slice
    case 'cancel':
    case 'close':
      return { view: 'closed', repoSelector: slice.repoSelector }
    default:
      return slice
  }
}

const withEntry = (
  batch: readonly FanOutBatchEntry[],
  mutationId: string,
  update: (entry: FanOutBatchEntry) => FanOutBatchEntry
): readonly FanOutBatchEntry[] =>
  batch.map((entry) => (entry.mutationId === mutationId ? update(entry) : entry))

function openForm(slice: FanOutSlice, parentId: WorktreeId): FanOutSlice {
  return {
    view: 'form',
    parentId,
    fields: { count: DEFAULT_FANOUT_COUNT, agent: 'none', prompt: '' },
    repoSelector: slice.repoSelector
  }
}

export const fanOutPromptRequiredMessage = (): string => t('fanout.promptRequired')
export const fanOutRepoUnresolvedMessage = (): string => t('fanout.repoUnresolved')

/** Why a submit can't proceed (form view only), or null. Shared by the reducer and the
 *  controller's pre-flight so the batch never starts on a form the reducer would reject. */
export function fanOutSubmitBlocker(slice: FanOutSlice): string | null {
  if (slice.view !== 'form') return null
  if (slice.fields.count < MIN_FANOUT || slice.fields.count > MAX_FANOUT) {
    return t('fanout.countRange', { min: MIN_FANOUT, max: MAX_FANOUT })
  }
  if (slice.repoSelector === null) return fanOutRepoUnresolvedMessage()
  // Why: with an agent, the prompt IS the workers' task spec — a blank one used to ship the
  // placeholder "Camada de N cubos", and lease workers got dispatched with nothing to do.
  if (slice.fields.agent !== 'none' && slice.fields.prompt.trim() === '') {
    return fanOutPromptRequiredMessage()
  }
  return null
}

function startSubmit(slice: FanOutSlice, mutationIds: readonly string[]): FanOutSlice {
  if (slice.view !== 'form') return slice
  const blocker = fanOutSubmitBlocker(slice)
  // The explicit null re-check only narrows repoSelector for TS; the blocker already rejects it.
  if (blocker !== null || slice.repoSelector === null) {
    return { ...slice, errorMessage: plainFailure(blocker ?? fanOutRepoUnresolvedMessage()) }
  }
  const batch: FanOutBatchEntry[] = mutationIds.map((mutationId) => ({
    mutationId,
    worktreeId: null,
    failed: false,
    dispatchId: null,
    taskId: null
  }))
  return {
    view: 'running',
    parentId: slice.parentId,
    fields: slice.fields,
    repoSelector: slice.repoSelector,
    batch,
    memberStatus: {},
    runId: null,
    decisionVisibility: emptyDecisionVisibility()
  }
}

/** fanout-<mutationId prefix> (language-neutral: persisted git refs must not depend on UI language) — the litter's worktree name and (Change B) lease task/worker displayName. */
export function cubeNameFor(mutationId: string): string {
  return `fanout-${mutationId.replace(/-/g, '').slice(0, 10)}`
}

/** Run objective / task spec text (Change B lease path). No generated fallback on purpose: the
 *  submit blocker guarantees a prompt whenever an agent runs, and the engine's `requiredString`
 *  rejects an empty one loudly rather than dispatching workers on a meaningless spec. */
export function fanOutObjectiveText(fields: FanOutFormFields): string {
  return fields.prompt.trim()
}

/** Maps form fields + parent lineage + resolved repo selector to N `worktree.create` params. */
export function toFanOutInputs(
  slice: FanOutSlice,
  repoSelector: string,
  mutationIds: readonly string[]
): CreateWorktreeInput[] {
  if (slice.view === 'closed') return []
  const { fields, parentId } = slice
  return mutationIds.map((mutationId) => {
    const input: CreateWorktreeInput = {
      repo: repoSelector,
      parentWorktree: parentId,
      clientMutationId: mutationId,
      // Why: fan-out has no name field (litter names are auto); the host rejects an empty name.
      name: cubeNameFor(mutationId),
      nameWasGenerated: true
    }
    if (fields.agent !== 'none') {
      input.startupAgent = fields.agent
      if (fields.prompt.trim() !== '') input.startupPrompt = fields.prompt
    }
    return input
  })
}

/** `worktree.ps` status → the graph's `AgentStatus` vocabulary. */
export function mapPsStatusToAgentStatus(psStatus: string): AgentStatus {
  if (psStatus === 'working') return 'working'
  if (psStatus === 'permission') return 'waiting-input'
  return 'idle'
}

const WORKING_DISPATCH_STATES = new Set(['ready', 'starting', 'start_unknown'])

/** `orchestration.workerList` worker state → the graph's `AgentStatus` vocabulary. */
export function mapDispatchStateToAgentStatus(workerState: string): AgentStatus {
  return WORKING_DISPATCH_STATES.has(workerState) ? 'working' : 'idle'
}

/** Terminal-failure signal for a dispatch row: worker crashed, or the dispatch itself did. */
export function isFailedDispatch(
  row: Pick<WorkerDispatchStateRow, 'workerState' | 'dispatchStatus'>
): boolean {
  return (
    row.workerState === 'failed' ||
    row.dispatchStatus === 'failed' ||
    row.dispatchStatus === 'circuit_broken'
  )
}

/** Parent plus every batch entry that already has a real worktreeId (pending/failed excluded). */
export function fanOutMemberIds(slice: FanOutSlice): readonly WorktreeId[] {
  if (slice.view === 'closed') return []
  const created =
    slice.view === 'running'
      ? slice.batch
          .filter(
            (entry): entry is FanOutBatchEntry & { worktreeId: WorktreeId } =>
              entry.worktreeId !== null
          )
          .map((entry) => entry.worktreeId)
      : []
  return [slice.parentId, ...created]
}

/** The camada's parent — the comparar label anchor and the first member of its framing.
 *  Null while the fan-out slice is closed. */
export function fanOutParentId(slice: FanOutSlice): WorktreeId | null {
  return slice.view === 'closed' ? null : slice.parentId
}

export type FanOutCounts = {
  total: number
  naciendo: number
  working: number
  waitingInput: number
  created: number
  failed: number
}

const emptyFanOutCounts = (): FanOutCounts => ({
  total: 0,
  naciendo: 0,
  working: 0,
  waitingInput: 0,
  created: 0,
  failed: 0
})

/** Partitions the batch ledger: naciendo/failed come from the ledger itself, working/waitingInput/created from memberStatus. */
export function fanOutCounts(slice: FanOutSlice): FanOutCounts {
  if (slice.view !== 'running') return emptyFanOutCounts()
  const counts = emptyFanOutCounts()
  counts.total = slice.batch.length
  for (const entry of slice.batch) {
    if (entry.failed) {
      counts.failed += 1
      continue
    }
    if (entry.worktreeId === null) {
      counts.naciendo += 1
      continue
    }
    const status = slice.memberStatus[entry.worktreeId] ?? 'idle'
    if (status === 'working') counts.working += 1
    else if (status === 'waiting-input') counts.waitingInput += 1
    else counts.created += 1
  }
  return counts
}

/** Nothing left to watch: every child created or failed, no agent working/waiting, no pending
 *  decision. An agent litter needs a first status per child — unpolled members read as idle. */
export function fanOutSettled(slice: FanOutSlice): boolean {
  if (slice.view !== 'running') return false
  const decision = fanOutDecisionCounts(slice)
  if (decision.gateCount > 0 || decision.questionCount > 0) return false
  return slice.batch.every((entry) => {
    if (entry.failed) return true
    if (entry.worktreeId === null) return false
    if (slice.fields.agent === 'none') return true
    const status = slice.memberStatus[entry.worktreeId]
    return status === 'idle'
  })
}

/** Run-level gate/question counts for the HUD line (Change C-EXTENDED); zero outside `running`. */
export function fanOutDecisionCounts(slice: FanOutSlice): {
  gateCount: number
  questionCount: number
} {
  if (slice.view !== 'running') return { gateCount: 0, questionCount: 0 }
  return decisionVisibilityCounts(slice.decisionVisibility ?? emptyDecisionVisibility())
}

const buildPlaceholder = (
  parent: WorktreeNode | undefined,
  entry: FanOutBatchEntry,
  parentId: WorktreeId
): WorktreeNode => ({
  id: `${FANOUT_PLACEHOLDER_PREFIX}${entry.mutationId}`,
  repoId: parent?.repoId ?? '',
  branch: '',
  path: '',
  status: 'pending',
  isMain: false,
  kind: 'worktree',
  parentId,
  childIds: [],
  activity: { ...inertActivity(), spawn: { phase: 'pending', progress: 0 } }
})

/**
 * Overlays the in-flight fan-out batch onto a real graph: a `spawning` placeholder node per
 * pending entry (linked into the parent's childIds — `childrenOf` reads that, not `edges`),
 * and `memberStatus` overlaid onto already-real members. Idempotent: strips stale placeholders
 * from the input before re-deriving, so composing on top of a prior composition converges.
 */
export function composeFanOutGraph(graph: WorktreeGraph, slice: FanOutSlice): WorktreeGraph {
  if (slice.view !== 'running') return graph

  const pending = slice.batch.filter((entry) => !entry.failed && entry.worktreeId === null)
  const pendingIds = pending.map((entry) => `${FANOUT_PLACEHOLDER_PREFIX}${entry.mutationId}`)
  const parent = graph.nodes.get(slice.parentId)

  const nodes = new Map<WorktreeId, WorktreeNode>()
  for (const [id, existing] of graph.nodes) {
    if (id.startsWith(FANOUT_PLACEHOLDER_PREFIX)) continue
    const status = slice.memberStatus[id]
    const withStatus =
      status !== undefined
        ? { ...existing, activity: { ...existing.activity, agentStatus: status } }
        : existing
    if (id === slice.parentId) {
      const keptChildIds = withStatus.childIds.filter(
        (childId) => !childId.startsWith(FANOUT_PLACEHOLDER_PREFIX)
      )
      nodes.set(id, { ...withStatus, childIds: [...keptChildIds, ...pendingIds] })
    } else {
      nodes.set(id, withStatus)
    }
  }
  for (const entry of pending) {
    const placeholder = buildPlaceholder(parent, entry, slice.parentId)
    nodes.set(placeholder.id, placeholder)
  }

  return { ...graph, nodes }
}
