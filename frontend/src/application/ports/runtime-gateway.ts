import type { RawWorktreeRecord } from '../../domain/worktree-graph/build-graph'

/** Repo identity from `repo.list`/`repo.add`; `id` alone builds an `id:`-style repo selector. */
export type RepoSummary = {
  id: string
  path: string
  displayName: string
  kind: 'git' | 'folder' | null
}

/** Startup agent choice for a spawned worktree; `'none'` omits agent params entirely. */
export type SpawnAgent = 'none' | 'claude'

export type CreateWorktreeInput = {
  repo: string
  name?: string
  /** True when `name` was auto-generated (not user-typed), so the host may retire it on collision. */
  nameWasGenerated?: boolean
  baseBranch?: string
  parentWorktree?: string
  startupAgent?: SpawnAgent
  startupPrompt?: string
  clientMutationId?: string
}

export type CreateWorktreeResult = {
  worktreeId: string
  warnings?: readonly string[]
}

/** One `worktree.ps` row: which worktree, and its live agent-process status. */
export type WorktreePsRow = {
  worktreeId: string
  status: string
}

/** One per-file row from `git.status`/`git.branchCompare` entries. */
export type GitStatusRow = {
  path: string
  status: string
  added: number
  removed: number
  /** Prior path for a `renamed` entry — omitted otherwise. */
  oldPath?: string
}

/** Minimal projection of `git.status` — not the full result; only what diff-mode/live-sync/fan-out need. */
export type GitStatus = {
  entries: readonly GitStatusRow[]
  branch: string
  branchLineTotal: number
}

/** Minimal projection of `git.branchCompare`. */
export type BranchCompare = {
  changedFiles: number
  commitsAhead: number
  commitsBehind: number
  baseRef: string
  headOid: string
  mergeBase: string
  status: string
  entries: readonly GitStatusRow[]
}

/** Per-file diff content from `git.branchDiff` — before/after text, or a binary marker. */
export type DiffFileContent =
  | { kind: 'text'; originalContent: string; modifiedContent: string; truncated: boolean }
  | { kind: 'binary'; mimeType?: string; modifiedDeleted?: boolean }

/** One `system.snapshot` node. Local mirror (rpc-purity) of the engine wire shape — no `state`,
 *  that ladder is derived frontend-side. `diff` is always null until Change D adds real git diff. */
export type SystemSnapshotNode = {
  id: string
  kind: 'router' | 'endpoint' | 'service' | 'database'
  label: string
  method?: string
  path?: string
  diff: null
}

export type SystemSnapshotEdge = {
  from: string
  to: string
  kind: 'normal' | 'flow' | 'faint'
}

/** Minimal projection of `system.snapshot` — the live system graph for one worktree. */
export type SystemGraphSnapshot = {
  nodes: readonly SystemSnapshotNode[]
  edges: readonly SystemSnapshotEdge[]
}

/** `orchestration.runCreate` with no `from` — a lease-run caller (Change B, camada lease). */
export type LeaseRunCreateInput = { objective: string }
export type LeaseRunCreateResult = { runId: string }

/** `orchestration.taskCreate` with no `callerTerminalHandle` — same lease-caller branch. */
export type LeaseTaskCreateInput = {
  spec: string
  run: string
  taskTitle?: string
  displayName?: string
  deps?: readonly string[]
}
export type LeaseTaskCreateResult = { taskId: string }

/** `orchestration.workerStart` with no `from`; `worktree` is required for a lease caller
 *  (the engine rejects current/new-child/new-top-level placement for it). */
export type LeaseWorkerStartInput = {
  task: string
  run: string
  worktree: string
  agent?: string
  name?: string
  displayName?: string
}
export type LeaseWorkerStartResult = {
  dispatchId: string
  runId: string
  taskId: string
  state: string
  stage: string
}

/** `orchestration.workerList` scoped to a lease Run — no `from` (Change C). */
export type LeaseWorkerListInput = { run: string; terminalState?: string }

/** One `orchestration.workerList` row, projected to only what member-status correlation needs. */
export type WorkerDispatchStateRow = {
  dispatchId: string
  workerState: string
  dispatchStatus: string
  worktreeId: string | null
}

export type LeaseWorkerListResult = { workers: readonly WorkerDispatchStateRow[] }

/** `orchestration.workerShow` for one live dispatch — no `from`, no `run` (Change C MINIMAL+):
 *  the engine derives lease ownership from the dispatch's own run_id, so only `dispatch` is sent. */
export type LeaseWorkerShowInput = { dispatch: string }

/** Projects only the waiting-for-human signal (`observation.agentWait`): true when the worker
 *  is parked on a prompt only a human can answer, false when observed and not waiting, null
 *  when the engine never looked (older host, unverifiable identity, unreadable pane). */
export type LeaseWorkerShowResult = { awaitingInput: boolean | null }

/** `orchestration.gateList` scoped to a lease Run — no `from` (Change C-EXTENDED). */
export type LeaseGateListInput = { run: string }

/** One `orchestration.gateList` row: a decision gate raised on the lease Run's tasks.
 *  `status`/other engine-owned enums stay plain `string` (mirrors `WorkerDispatchStateRow`) so a
 *  future engine-side status value doesn't require a frontend type change. */
export type LeaseGateRow = {
  id: string
  runId: string
  taskId: string
  question: string
  options: string
  status: string
  resolution: string | null
  createdAt: string
  resolvedAt: string | null
}

export type LeaseGateListResult = { gates: readonly LeaseGateRow[] }

/** `orchestration.gateResolve` — a paired GUI lease caller resolving one of its Run's pending
 *  gates (Change F); no `from` (routes via pairedDeviceId+clientKind like every lease verb). */
export type LeaseGateResolveInput = { run: string; gateId: string; resolution: string }
export type LeaseGateResolveResult = { gate: LeaseGateRow }

/** `orchestration.questionList` scoped to a lease Run — no `from` (Change C-EXTENDED); the
 *  method itself is only reachable via a paired GUI Run lease (engine-side). */
export type LeaseQuestionListInput = { run: string }

/** One `orchestration.questionList` row: an inbox question thread on the lease Run. `question`
 *  (the prompt text, LEFT JOINed from the source message) is optional — an older host may not
 *  project it yet (Change F wave E4), so the reply UI falls back to asker/dispatch context. */
export type LeaseQuestionRow = {
  messageId: string
  runId: string
  dispatchId: string
  askerHandle: string
  status: string
  answerMessageId: string | null
  answerBody: string | null
  answeredByGeneration: number | null
  createdAt: string
  answeredAt: string | null
  closedAt: string | null
  question?: string
}

export type LeaseQuestionListResult = { questions: readonly LeaseQuestionRow[] }

/** `orchestration.reply` on a question thread — a paired GUI lease caller answering one of its
 *  Run's pending questions (Change F); no `from`. Wire method name is `orchestration.reply`
 *  (also serves plain-message replies engine-side), but this port method is question-scoped only. */
export type LeaseQuestionAnswerInput = { run: string; messageId: string; body: string }
export type LeaseQuestionAnswerResult = { messageId: string; duplicate: boolean }

/** Local mirror of the engine's `agent.activity` event kind (agent-activity-ring.ts). */
export type AgentActivityKind = 'read' | 'edit' | 'create' | 'run'

/** One `agent.activity` event, projected for the client — no `worktreeId`/`paneKey` (the caller
 *  already scopes by worktree; pane identity is host-internal). */
export type AgentActivityEvent = {
  seq: number
  at: number
  kind: AgentActivityKind
  tool: string
  target: string
  agent?: string
}

/** Minimal projection of `agent.activity` — one page of a worktree's activity ring. */
export type AgentActivityPage = {
  events: readonly AgentActivityEvent[]
  latestSeq: number
}

export type AgentActivityInput = { worktree: string; sinceSeq?: number; limit?: number }

/** `workingTree` sub-shape on a clean `MergeWinnerResult` (v3-2): opt-in parent working-tree
 *  sync outcome. Absent = not requested (old host, or the caller didn't ask). */
export type ParentWorkingTreeSyncResult =
  | { status: 'synced' }
  | { status: 'skipped'; reason: 'dirty' }
  /** Merged but unsynced; previousOid (newer hosts) is the parent tip before the merge. */
  | { status: 'failed'; message: string; previousOid?: string }

/** Why a synced merge refused to start (nothing changed); unknown values arrive as sync-refused. */
export type MergeBlockReason =
  | 'untracked-overwrite'
  | 'ignored-overwrite'
  | 'dirty-parent'
  | 'sync-refused'
  | 'sync-failed'

/** `known: false` = the host could not read orca.yaml (e.g. SSH filesystem down): absence proves nothing. */
export type RepoSetupInfo = {
  readonly local: string | null
  readonly shared: string | null
  readonly known: boolean
}

/** Optional `dependencySetup` on a clean merge: the parent's setup hook was started in the
 *  background because package manifests/lockfiles changed. Absent = did not apply (or an older host). */
export type ParentDependencySetupResult = { status: 'started' }

/** `git.mergeWinnerIntoParent` result (Change E): LOCAL mirror of the engine's headless-merge
 *  outcome — clean moves the parent branch ref, conflict mutates nothing (file-name list only). */
export type MergeWinnerResult =
  | {
      outcome: 'clean'
      commitOid: string
      workingTree?: ParentWorkingTreeSyncResult
      dependencySetup?: ParentDependencySetupResult
    }
  | { outcome: 'conflict'; files: readonly string[] }
  | { outcome: 'blocked'; reason: MergeBlockReason; paths: readonly string[]; message?: string }
  /** The parent already contains the winner; commitOid is the untouched parent tip. */
  | { outcome: 'already-merged'; commitOid: string }

/** Staging area of one `git.status` entry; a path edited after staging appears in two areas. */
export type GitStagingArea = 'staged' | 'unstaged' | 'untracked'

/** `git.status` projected for source control: staging areas + upstream counters (not the diff-mode GitStatus). */
export type SourceControlStatus = {
  branch: string
  entries: readonly { path: string; area: GitStagingArea }[]
  hasUpstream: boolean
  ahead: number
  behind: number
}

/** `git.commit` reports a refused commit as `success: false` instead of throwing. */
export type GitCommitResult = { success: true } | { success: false; error: string }

/** Hosted review (GitHub PR, GitLab MR, ...) as the host reports it; `provider` stays opaque. */
export type HostedReviewLink = { number?: number; url: string }

export type HostedReviewEligibilityInput = {
  repo: string
  worktree: string
  branch: string
  base: string | null
  hasUncommittedChanges: boolean
  hasUpstream: boolean
  ahead: number
  behind: number
}

/** `blockedReason`/`nextAction` stay plain strings: a newer host may name values this build lacks. */
export type HostedReviewEligibility = {
  provider: string
  review: HostedReviewLink | null
  canCreate: boolean
  blockedReason: string | null
  nextAction: string | null
  defaultBaseRef: string | null
  head: string | null
  title: string | null
  body: string | null
}

export type HostedReviewCreateInput = {
  repo: string
  worktree: string
  provider: string
  base: string
  head?: string
  title: string
  body?: string
  draft?: boolean
}

/** Refusals come back as data (`ok: false`), never as a throw. */
export type HostedReviewCreateResult =
  | { ok: true; number?: number; url: string }
  | { ok: false; code: string; error: string; existingReview?: HostedReviewLink }

export type FilePathMatch = { relativePath: string; basename: string; binary: boolean }

/** Ranked quick-open matches; `truncated` means more files matched than were returned. */
export type FilePathSearchResult = { files: readonly FilePathMatch[]; truncated: boolean }

/** `files.read` is a text preview: `truncated` content must never be written back. */
export type FileReadResult = { content: string; truncated: boolean; byteLength: number }

/** `mtime` is epoch milliseconds from the host; size+mtime together detect an outside edit. */
export type FileStamp = { size: number; mtime: number }

/** `worktree.rm` knobs: `hostId` pins the executing host (SSH); `force` removes a dirty tree. */
export type WorktreeRemoveOptions = { hostId?: string; force?: boolean }

export type WorktreeRemoveResult = {
  removed: true
  warning?: string
  /** The branch survived removal (unmerged work); the host did not delete it. */
  preservedBranch?: string
}

/**
 * Port to the orcad runtime. The application layer depends on this shape
 * only; infrastructure provides the RPC-backed implementation.
 */
export type RuntimeGateway = {
  listWorktrees(): Promise<readonly RawWorktreeRecord[]>
  listRepos(): Promise<readonly RepoSummary[]>
  createWorktree(input: CreateWorktreeInput): Promise<CreateWorktreeResult>
  addRepo(input: { path: string; kind?: 'git' | 'folder' }): Promise<RepoSummary>
  listWorktreePs(): Promise<readonly WorktreePsRow[]>
  gitStatus(worktree: string): Promise<GitStatus>
  gitBranchCompare(worktree: string, baseRef: string): Promise<BranchCompare>
  gitBranchDiff(
    worktree: string,
    compare: { mergeBase: string; headOid: string },
    filePath: string,
    oldPath?: string
  ): Promise<DiffFileContent>
  /** HEAD→worktree diff via `git.diff {staged:false, compareAgainstHead:true}` — for a path with
   *  no branch-vs-base change, only an uncommitted one (Change: diff-working-tree). */
  gitWorkingTreeDiff(worktree: string, filePath: string): Promise<DiffFileContent>
  systemSnapshot(worktree: string): Promise<SystemGraphSnapshot>
  orchestrationRunCreate(input: LeaseRunCreateInput): Promise<LeaseRunCreateResult>
  orchestrationTaskCreate(input: LeaseTaskCreateInput): Promise<LeaseTaskCreateResult>
  orchestrationWorkerStart(input: LeaseWorkerStartInput): Promise<LeaseWorkerStartResult>
  orchestrationWorkerList(input: LeaseWorkerListInput): Promise<LeaseWorkerListResult>
  orchestrationWorkerShow(input: LeaseWorkerShowInput): Promise<LeaseWorkerShowResult>
  orchestrationGateList(input: LeaseGateListInput): Promise<LeaseGateListResult>
  orchestrationGateResolve(input: LeaseGateResolveInput): Promise<LeaseGateResolveResult>
  orchestrationQuestionList(input: LeaseQuestionListInput): Promise<LeaseQuestionListResult>
  orchestrationQuestionAnswer(input: LeaseQuestionAnswerInput): Promise<LeaseQuestionAnswerResult>
  /** Headless-merges the winner child's branch into the parent branch (Change E). `message`
   *  defaults host-side when omitted. */
  gitMergeWinnerIntoParent(
    parent: string,
    winner: string,
    message?: string,
    syncWorkingTree?: boolean
  ): Promise<MergeWinnerResult>
  gitSourceControlStatus(worktree: string): Promise<SourceControlStatus>
  /** Bulk stage/unstage; an empty list is a no-op. */
  gitStage(worktree: string, paths: readonly string[]): Promise<void>
  gitUnstage(worktree: string, paths: readonly string[]): Promise<void>
  gitCommit(worktree: string, message: string): Promise<GitCommitResult>
  /** `publish` sets the upstream (first push of a branch); rejects when the remote refuses. */
  gitPush(worktree: string, options?: { publish?: boolean }): Promise<void>
  hostedReviewEligibility(input: HostedReviewEligibilityInput): Promise<HostedReviewEligibility>
  hostedReviewCreate(input: HostedReviewCreateInput): Promise<HostedReviewCreateResult>
  /** Fuzzy path search (ripgrep on the host, no git needed); `limit` is clamped to the host's 32. */
  filesSearchPaths(worktree: string, query: string, limit?: number): Promise<FilePathSearchResult>
  /** Rejects with `binary_file` for binary paths; text only. */
  filesRead(worktree: string, relativePath: string): Promise<FileReadResult>
  filesStat(worktree: string, relativePath: string): Promise<FileStamp>
  /** Whole-file overwrite with no host-side conflict check: callers compare `filesStat` first.
   * `hostId` is the node's execution host; the host refuses mutations that do not name it. */
  filesWrite(
    worktree: string,
    relativePath: string,
    content: string,
    hostId?: string
  ): Promise<void>
  /** Removes a worktree (the host stops its PTYs/agents itself); rejects when git refuses, e.g. dirty. */
  worktreeRemove(worktree: string, options?: WorktreeRemoveOptions): Promise<WorktreeRemoveResult>
  agentActivity(input: AgentActivityInput): Promise<AgentActivityPage>
  /** Effective setup command for a repo (orca.yaml or local override); null when none; rejects when unknown. */
  repoSetupCommand(repo: string): Promise<string | null>
  /** Where a repo's setup comes from; the editor only owns `local`, `shared` is read-only orca.yaml. */
  repoSetupInfo(repo: string): Promise<RepoSetupInfo>
  /** Persists the repo-local setup command via `repo.update` hookSettings; '' clears it. */
  setRepoSetupCommand(repo: string, command: string): Promise<void>
}
