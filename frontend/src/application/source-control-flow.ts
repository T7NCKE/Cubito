import type { WorktreeId } from '../domain/worktree-graph/types'
import { resolveBaseRef } from '../domain/worktree-graph/resolve-base-ref'
import { shortBranchName } from '../presentation/hud/node-label-model'
import { authRequiredMessage, reviewKindName } from './hosted-review-presentation'
import { t } from './i18n/translate'
import { describeFailure, plainFailure } from './i18n/user-facing-error'
import type { FailureMessage } from './i18n/user-facing-error'
import type { FailureAction } from './i18n/user-facing-error'
import type {
  HostedReviewEligibility,
  RuntimeGateway,
  SourceControlStatus
} from './ports/runtime-gateway'
import type { SceneStore } from './scene-store'

export type SourceControlGatewayPort = Pick<
  RuntimeGateway,
  | 'gitSourceControlStatus'
  | 'gitStage'
  | 'gitUnstage'
  | 'gitCommit'
  | 'gitPush'
  | 'hostedReviewEligibility'
  | 'hostedReviewCreate'
>

export type StageState = 'staged' | 'partial' | 'unstaged'
export type SourceControlBusy = 'stage' | 'commit' | 'push'
export type SourceControlNotice = { tone: 'ok' | 'error'; message: FailureMessage }

export type ReviewResult = { tone: 'ok' | 'error'; message: FailureMessage; href?: string }

/** `unavailable`: no remote/provider answer; the commit and push controls still work. */
export type ReviewState =
  | { phase: 'unavailable' }
  | {
      phase: 'ready'
      eligibility: HostedReviewEligibility
      title: string
      body: string
      draft: boolean
      /** Once the user edits the form, an eligibility reload no longer overwrites it. */
      touched: boolean
      creating: boolean
      result: ReviewResult | null
    }

export type SourceControlView =
  | { phase: 'hidden' }
  | {
      phase: 'ready'
      nodeId: WorktreeId
      branch: string
      stageStates: ReadonlyMap<string, StageState>
      stagedCount: number
      hasUpstream: boolean
      ahead: number
      behind: number
      message: string
      busy: SourceControlBusy | null
      notice: SourceControlNotice | null
      review: ReviewState
      canCommit: boolean
      canPush: boolean
    }

export type SourceControlFlowDeps = {
  store: SceneStore
  gateway: SourceControlGatewayPort
  /** Reloads the diff rail so staged/committed files show their new state. */
  refreshDiff(): void
}

export type SourceControlFlow = {
  view(): SourceControlView
  subscribe(listener: (view: SourceControlView) => void): () => void
  /** Loads status for a node; stays hidden for folder workspaces or when git.status fails. */
  open(nodeId: WorktreeId): Promise<void>
  close(): void
  /** Re-reads status in place (after a file was edited); no-op while hidden. */
  reload(): Promise<void>
  /** Silent live poll: status only (no review lookup), notifies only on change, never hides. */
  refreshStatus(): Promise<void>
  toggleStage(path: string): Promise<void>
  setMessage(message: string): void
  commit(): Promise<void>
  push(): Promise<void>
  setReviewForm(form: { title?: string; body?: string; draft?: boolean }): void
  /** The one next step toward a review, chosen by the host's nextAction. */
  reviewPrimary(): Promise<void>
  rebindGateway(gateway: SourceControlGatewayPort): void
}

type Ready = Extract<SourceControlView, { phase: 'ready' }>

const BUSY_FAILURE: Record<SourceControlBusy, FailureAction> = {
  stage: 'sourceControlStage',
  commit: 'sourceControlCommit',
  push: 'sourceControlPush'
}

function stageStatesOf(entries: SourceControlStatus['entries']): Map<string, StageState> {
  const areas = new Map<string, { staged: boolean; unstaged: boolean }>()
  for (const entry of entries) {
    const area = areas.get(entry.path) ?? { staged: false, unstaged: false }
    if (entry.area === 'staged') area.staged = true
    else area.unstaged = true
    areas.set(entry.path, area)
  }
  return new Map(
    [...areas].map(([path, area]) => [
      path,
      area.staged ? (area.unstaged ? 'partial' : 'staged') : 'unstaged'
    ])
  )
}

const withDerived = (view: Omit<Ready, 'canCommit' | 'canPush'>): Ready => ({
  ...view,
  canCommit: view.busy === null && view.stagedCount > 0 && view.message.trim().length > 0,
  // Why: an existing upstream with nothing ahead has nothing to push; no upstream means publish.
  canPush: view.busy === null && (!view.hasUpstream || view.ahead > 0)
})

export function createSourceControlFlow(deps: SourceControlFlowDeps): SourceControlFlow {
  let gateway = deps.gateway
  let current: SourceControlView = { phase: 'hidden' }
  let generation = 0
  const listeners = new Set<(view: SourceControlView) => void>()

  function set(next: SourceControlView): void {
    current = next
    for (const listener of [...listeners]) listener(current)
  }

  function patch(patchFields: Partial<Omit<Ready, 'canCommit' | 'canPush'>>): void {
    if (current.phase !== 'ready') return
    const { canCommit: _c, canPush: _p, ...base } = current
    set(withDerived({ ...base, ...patchFields }))
  }

  /** Re-reads status for the current node; returns false when superseded or git.status failed. */
  async function reload(nodeId: WorktreeId, ownGeneration: number): Promise<boolean> {
    let status: SourceControlStatus
    try {
      status = await gateway.gitSourceControlStatus(nodeId)
    } catch {
      if (ownGeneration === generation) set({ phase: 'hidden' })
      return false
    }
    if (ownGeneration !== generation) return false
    const stageStates = stageStatesOf(status.entries)
    const previous = current.phase === 'ready' ? current : null
    set(
      withDerived({
        phase: 'ready',
        nodeId,
        branch: status.branch,
        stageStates,
        stagedCount: [...stageStates.values()].filter((state) => state !== 'unstaged').length,
        hasUpstream: status.hasUpstream,
        ahead: status.ahead,
        behind: status.behind,
        message: previous?.message ?? '',
        busy: previous?.busy ?? null,
        notice: previous?.notice ?? null,
        review: previous?.review ?? { phase: 'unavailable' }
      })
    )
    await loadReview(nodeId, ownGeneration)
    return ownGeneration === generation
  }

  /** Best effort: any failure just hides the review controls. */
  async function loadReview(nodeId: WorktreeId, ownGeneration: number): Promise<void> {
    const view = current
    const node = deps.store.get().graph.nodes.get(nodeId)
    if (view.phase !== 'ready' || !node) return
    const base = resolveBaseRef(deps.store.get().graph, nodeId)
    let eligibility: HostedReviewEligibility
    try {
      eligibility = await gateway.hostedReviewEligibility({
        repo: `id:${node.repoId}`,
        worktree: nodeId,
        branch: shortBranchName(node.branch),
        base: base === null ? null : shortBranchName(base),
        hasUncommittedChanges: view.stageStates.size > 0,
        hasUpstream: view.hasUpstream,
        ahead: view.ahead,
        behind: view.behind
      })
    } catch {
      if (ownGeneration === generation) patch({ review: { phase: 'unavailable' } })
      return
    }
    if (ownGeneration !== generation || current.phase !== 'ready') return
    const previous = current.review.phase === 'ready' ? current.review : null
    const keep = previous?.touched === true
    patch({
      review: {
        phase: 'ready',
        eligibility,
        title: keep ? previous.title : (eligibility.title ?? ''),
        body: keep ? previous.body : (eligibility.body ?? ''),
        draft: previous?.draft ?? false,
        touched: keep,
        creating: false,
        result: previous?.result ?? null
      }
    })
  }

  function patchReview(fields: Partial<Extract<ReviewState, { phase: 'ready' }>>): void {
    if (current.phase !== 'ready' || current.review.phase !== 'ready') return
    patch({ review: { ...current.review, ...fields } })
  }

  async function createReview(): Promise<void> {
    if (current.phase !== 'ready' || current.review.phase !== 'ready') return
    const { nodeId } = current
    const { eligibility, title, body, draft, creating } = current.review
    const node = deps.store.get().graph.nodes.get(nodeId)
    const base = eligibility.defaultBaseRef ?? resolveBaseRef(deps.store.get().graph, nodeId)
    if (creating || !eligibility.canCreate || title.trim() === '' || !node || base === null) return
    const ownGeneration = generation
    patchReview({ creating: true, result: null })
    let result: ReviewResult
    try {
      const created = await gateway.hostedReviewCreate({
        repo: `id:${node.repoId}`,
        worktree: nodeId,
        provider: eligibility.provider,
        base: shortBranchName(base),
        head: eligibility.head ?? shortBranchName(node.branch),
        title: title.trim(),
        body,
        draft
      })
      const kind = reviewKindName(eligibility.provider)
      if (created.ok) {
        result = {
          tone: 'ok',
          message: plainFailure(
            t('review.created', {
              ref: `${kind}${created.number === undefined ? '' : ` #${created.number}`}`
            })
          ),
          href: created.url
        }
      } else {
        result = {
          tone: 'error',
          message: describeFailure('reviewCreate', created.error, created.code),
          ...(created.existingReview ? { href: created.existingReview.url } : {})
        }
      }
    } catch (error) {
      result = { tone: 'error', message: describeFailure('reviewCreate', error) }
    }
    if (ownGeneration !== generation) return
    patchReview({ creating: false, result })
    await loadReview(nodeId, ownGeneration)
  }

  async function run(
    busy: SourceControlBusy,
    action: (view: Ready) => Promise<SourceControlNotice | null>
  ): Promise<void> {
    if (current.phase !== 'ready' || current.busy !== null) return
    const { nodeId } = current
    const ownGeneration = generation
    patch({ busy, notice: null })
    let notice: SourceControlNotice | null
    try {
      notice = await action(current as Ready)
    } catch (error) {
      notice = { tone: 'error', message: describeFailure(BUSY_FAILURE[busy], error) }
    }
    if (ownGeneration !== generation) return
    patch({ busy: null, notice })
    if (await reload(nodeId, ownGeneration)) deps.refreshDiff()
  }

  return {
    view: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async open(nodeId) {
      const ownGeneration = ++generation
      set({ phase: 'hidden' })
      const node = deps.store.get().graph.nodes.get(nodeId)
      const repo = deps.store.get().repos.list.find((entry) => entry.id === node?.repoId)
      if (!node || repo?.kind === 'folder') return
      await reload(nodeId, ownGeneration)
    },
    async reload() {
      if (current.phase !== 'ready') return
      await reload(current.nodeId, generation)
    },
    async refreshStatus() {
      if (current.phase !== 'ready' || current.busy !== null) return
      const { nodeId } = current
      const ownGeneration = generation
      let status: SourceControlStatus
      try {
        status = await gateway.gitSourceControlStatus(nodeId)
      } catch {
        return
      }
      if (ownGeneration !== generation || current.phase !== 'ready' || current.busy !== null) return
      const stageStates = stageStatesOf(status.entries)
      const unchanged =
        current.branch === status.branch &&
        current.hasUpstream === status.hasUpstream &&
        current.ahead === status.ahead &&
        current.behind === status.behind &&
        current.stageStates.size === stageStates.size &&
        [...stageStates].every(
          ([path, state]) => current.phase === 'ready' && current.stageStates.get(path) === state
        )
      if (unchanged) return
      patch({
        branch: status.branch,
        stageStates,
        stagedCount: [...stageStates.values()].filter((state) => state !== 'unstaged').length,
        hasUpstream: status.hasUpstream,
        ahead: status.ahead,
        behind: status.behind
      })
    },
    close() {
      generation += 1
      set({ phase: 'hidden' })
    },
    toggleStage(path) {
      return run('stage', async (view) => {
        const state = view.stageStates.get(path)
        if (state === undefined) return null
        if (state === 'staged') await gateway.gitUnstage(view.nodeId, [path])
        else await gateway.gitStage(view.nodeId, [path])
        return null
      })
    },
    setMessage(message) {
      patch({ message })
    },
    commit() {
      if (current.phase !== 'ready' || !current.canCommit) return Promise.resolve()
      return run('commit', async (view) => {
        const result = await gateway.gitCommit(view.nodeId, view.message.trim())
        if (!result.success)
          return { tone: 'error', message: describeFailure('sourceControlCommit', result.error) }
        patch({ message: '' })
        return { tone: 'ok', message: plainFailure(t('sourceControl.commitCreated')) }
      })
    },
    push() {
      if (current.phase !== 'ready' || !current.canPush) return Promise.resolve()
      return run('push', async (view) => {
        await gateway.gitPush(view.nodeId, view.hasUpstream ? {} : { publish: true })
        return {
          tone: 'ok',
          message: plainFailure(
            view.hasUpstream ? t('sourceControl.pushed') : t('sourceControl.branchPublished')
          )
        }
      })
    },
    setReviewForm(form) {
      patchReview({ ...form, touched: true })
    },
    async reviewPrimary() {
      if (current.phase !== 'ready' || current.review.phase !== 'ready') return
      switch (current.review.eligibility.nextAction) {
        case 'commit':
          if (current.canCommit) await this.commit()
          else
            patch({
              notice: {
                tone: 'error',
                message: plainFailure(t('sourceControl.needsStageAndMessage'))
              }
            })
          return
        case 'publish':
        case 'push':
          await this.push()
          return
        case 'sync':
          patch({
            notice: {
              tone: 'error',
              message: plainFailure(t('sourceControl.behindRemote'))
            }
          })
          return
        case 'authenticate':
          patch({ notice: { tone: 'error', message: plainFailure(authRequiredMessage()) } })
          return
        case null:
        default:
          await createReview()
      }
    },
    rebindGateway(next) {
      gateway = next
    }
  }
}
