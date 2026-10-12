import { describe, expect, it, vi } from 'vitest'
import { createSourceControlFlow } from './source-control-flow'
import type { SourceControlView } from './source-control-flow'
import { createSceneStore } from './scene-store'
import { buildWorktreeGraph } from '../domain/worktree-graph/build-graph'
import type {
  GitCommitResult,
  HostedReviewCreateInput,
  HostedReviewCreateResult,
  HostedReviewEligibilityInput,
  HostedReviewEligibility,
  SourceControlStatus
} from './ports/runtime-gateway'
import { authRequiredMessage } from './hosted-review-presentation'
import { describeFailure } from './i18n/user-facing-error'
import { setActiveLanguage } from './i18n/translate'

const eligibility = (over: Partial<HostedReviewEligibility> = {}): HostedReviewEligibility => ({
  provider: 'github',
  review: null,
  canCreate: true,
  blockedReason: null,
  nextAction: null,
  defaultBaseRef: 'main',
  head: 'feat',
  title: 'Add x',
  body: 'Body',
  ...over
})

const status = (over: Partial<SourceControlStatus> = {}): SourceControlStatus => ({
  branch: 'feat',
  entries: [
    { path: 'a.ts', area: 'staged' },
    { path: 'b.ts', area: 'unstaged' },
    { path: 'c.ts', area: 'staged' },
    { path: 'c.ts', area: 'unstaged' },
    { path: 'd.ts', area: 'untracked' }
  ],
  hasUpstream: true,
  ahead: 1,
  behind: 0,
  ...over
})

function setup(
  opts: {
    repoKind?: 'git' | 'folder'
    status?: () => Promise<SourceControlStatus>
    eligibility?: HostedReviewEligibility
  } = {}
) {
  const store = createSceneStore()
  store.update({
    graph: buildWorktreeGraph([
      {
        id: 'r::/w',
        repoId: 'r',
        branch: 'refs/heads/feat',
        parentWorktreeId: null,
        childWorktreeIds: [],
        workspaceStatus: 'in-progress',
        git: { path: '/w', isMainWorktree: false }
      }
    ])
  })
  store.dispatchRepos({
    type: 'set-list',
    list: [{ id: 'r', path: '/r', displayName: 'R', kind: opts.repoKind ?? 'git' }]
  })
  const gateway = {
    gitSourceControlStatus: vi.fn(opts.status ?? (async () => status())),
    gitStage: vi.fn<(w: string, p: readonly string[]) => Promise<void>>(async () => undefined),
    gitUnstage: vi.fn<(w: string, p: readonly string[]) => Promise<void>>(async () => undefined),
    gitCommit: vi.fn<(w: string, m: string) => Promise<GitCommitResult>>(async () => ({
      success: true
    })),
    gitPush: vi.fn<(w: string, o?: { publish?: boolean }) => Promise<void>>(async () => undefined),
    hostedReviewEligibility: vi.fn<
      (i: HostedReviewEligibilityInput) => Promise<HostedReviewEligibility>
    >(async () => opts.eligibility ?? eligibility()),
    hostedReviewCreate: vi.fn<(i: HostedReviewCreateInput) => Promise<HostedReviewCreateResult>>(
      async () => ({ ok: true, number: 12, url: 'https://x/pull/12' })
    )
  }
  const refreshDiff = vi.fn()
  const flow = createSourceControlFlow({ store, gateway, refreshDiff })
  return { flow, gateway, refreshDiff, store }
}

const ready = (view: SourceControlView) => {
  if (view.phase !== 'ready') throw new Error(`expected ready, got ${view.phase}`)
  return view
}

describe('source control flow', () => {
  it('reload re-reads status in place, keeping the typed message and never hiding', async () => {
    const { flow, gateway } = setup()
    await flow.open('r::/w')
    flow.setMessage('wip')
    const phases: string[] = []
    flow.subscribe((view) => phases.push(view.phase))
    gateway.gitSourceControlStatus.mockResolvedValueOnce(
      status({ entries: [{ path: 'new.ts', area: 'unstaged' }] })
    )
    await flow.reload()
    expect(phases).not.toContain('hidden')
    const view = ready(flow.view())
    expect(view.message).toBe('wip')
    expect([...view.stageStates.keys()]).toEqual(['new.ts'])
  })

  it('refreshStatus picks up ahead/behind silently and skips the review lookup', async () => {
    const { flow, gateway } = setup()
    await flow.open('r::/w')
    const reviewCalls = gateway.hostedReviewEligibility.mock.calls.length
    gateway.gitSourceControlStatus.mockResolvedValueOnce(status({ ahead: 3 }))
    await flow.refreshStatus()
    expect(ready(flow.view()).ahead).toBe(3)
    expect(gateway.hostedReviewEligibility.mock.calls.length).toBe(reviewCalls)
  })

  it('refreshStatus does not notify when nothing changed and never hides on failure', async () => {
    const { flow, gateway } = setup()
    await flow.open('r::/w')
    const phases: string[] = []
    flow.subscribe((view) => phases.push(view.phase))
    await flow.refreshStatus()
    gateway.gitSourceControlStatus.mockRejectedValueOnce(new Error('offline'))
    await flow.refreshStatus()
    expect(phases).toEqual([])
    expect(flow.view().phase).toBe('ready')
  })

  it('reload does nothing while hidden', async () => {
    const { flow, gateway } = setup()
    await flow.reload()
    expect(gateway.gitSourceControlStatus).not.toHaveBeenCalled()
  })

  it('stays hidden for a folder workspace without calling git', async () => {
    const { flow, gateway } = setup({ repoKind: 'folder' })
    await flow.open('r::/w')
    expect(flow.view().phase).toBe('hidden')
    expect(gateway.gitSourceControlStatus).not.toHaveBeenCalled()
  })

  it('hides itself when git.status fails', async () => {
    const { flow } = setup({
      status: async () => {
        throw new Error('not a git repo')
      }
    })
    await flow.open('r::/w')
    expect(flow.view().phase).toBe('hidden')
  })

  it('derives per-path stage states: staged, partial and unstaged', async () => {
    const { flow } = setup()
    await flow.open('r::/w')
    const view = ready(flow.view())
    expect([...view.stageStates]).toEqual([
      ['a.ts', 'staged'],
      ['b.ts', 'unstaged'],
      ['c.ts', 'partial'],
      ['d.ts', 'unstaged']
    ])
    expect(view.stagedCount).toBe(2)
  })

  it('toggle stages an unstaged/partial path and unstages a staged one, then refreshes', async () => {
    const { flow, gateway, refreshDiff } = setup()
    await flow.open('r::/w')
    await flow.toggleStage('b.ts')
    expect(gateway.gitStage).toHaveBeenCalledWith('r::/w', ['b.ts'])
    await flow.toggleStage('a.ts')
    expect(gateway.gitUnstage).toHaveBeenCalledWith('r::/w', ['a.ts'])
    await flow.toggleStage('c.ts')
    expect(gateway.gitStage).toHaveBeenLastCalledWith('r::/w', ['c.ts'])
    expect(refreshDiff).toHaveBeenCalledTimes(3)
    expect(gateway.gitSourceControlStatus).toHaveBeenCalledTimes(4)
  })

  it('surfaces a stage failure as an error notice', async () => {
    const { flow, gateway } = setup()
    gateway.gitStage.mockRejectedValueOnce(new Error('index.lock exists'))
    await flow.open('r::/w')
    await flow.toggleStage('b.ts')
    expect(ready(flow.view()).notice).toEqual({
      tone: 'error',
      message: describeFailure('sourceControlStage', 'index.lock exists')
    })
    expect(describeFailure('sourceControlStage', 'index.lock exists')).toEqual({
      lead: 'no se pudo actualizar el stage',
      detail: 'index.lock exists'
    })
  })

  it('commit needs a message and staged files', async () => {
    const { flow, gateway } = setup({ status: async () => status({ entries: [] }) })
    await flow.open('r::/w')
    flow.setMessage('msg')
    expect(ready(flow.view()).canCommit).toBe(false)
    await flow.commit()
    expect(gateway.gitCommit).not.toHaveBeenCalled()
  })

  it('commits the trimmed message, clears it and refreshes', async () => {
    const { flow, gateway, refreshDiff } = setup()
    await flow.open('r::/w')
    flow.setMessage('  feat: x  ')
    expect(ready(flow.view()).canCommit).toBe(true)
    await flow.commit()
    expect(gateway.gitCommit).toHaveBeenCalledWith('r::/w', 'feat: x')
    const view = ready(flow.view())
    expect(view.message).toBe('')
    expect(view.notice?.tone).toBe('ok')
    expect(refreshDiff).toHaveBeenCalled()
  })

  it('keeps the message and shows the host error when git.commit answers success:false', async () => {
    const { flow, gateway } = setup()
    gateway.gitCommit.mockResolvedValueOnce({ success: false, error: 'hook failed' })
    await flow.open('r::/w')
    flow.setMessage('feat: x')
    await flow.commit()
    const view = ready(flow.view())
    expect(view.message).toBe('feat: x')
    expect(view.notice).toEqual({
      tone: 'error',
      message: describeFailure('sourceControlCommit', 'hook failed')
    })
  })

  it('pushes plainly with an upstream and publishes without one', async () => {
    const withUpstream = setup()
    await withUpstream.flow.open('r::/w')
    await withUpstream.flow.push()
    expect(withUpstream.gateway.gitPush).toHaveBeenCalledWith('r::/w', {})

    const without = setup({ status: async () => status({ hasUpstream: false, ahead: 0 }) })
    await without.flow.open('r::/w')
    await without.flow.push()
    expect(without.gateway.gitPush).toHaveBeenCalledWith('r::/w', { publish: true })
  })

  it('push is disabled when there is an upstream and nothing ahead', async () => {
    const { flow, gateway } = setup({ status: async () => status({ ahead: 0 }) })
    await flow.open('r::/w')
    expect(ready(flow.view()).canPush).toBe(false)
    await flow.push()
    expect(gateway.gitPush).not.toHaveBeenCalled()
  })

  it('reports a push failure and ignores actions while one is in flight', async () => {
    const gate: { release: () => void } = { release: () => undefined }
    const { flow, gateway } = setup()
    gateway.gitPush.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          gate.release = () => reject(new Error('rejected (non-fast-forward)'))
        })
    )
    await flow.open('r::/w')
    const first = flow.push()
    void flow.push()
    await flow.toggleStage('b.ts')
    expect(gateway.gitPush).toHaveBeenCalledTimes(1)
    expect(gateway.gitStage).not.toHaveBeenCalled()
    expect(ready(flow.view()).busy).toBe('push')
    gate.release()
    await first
    expect(ready(flow.view()).busy).toBeNull()
    expect(ready(flow.view()).notice).toEqual({
      tone: 'error',
      message: describeFailure('sourceControlPush', 'rejected (non-fast-forward)')
    })
  })

  it('close drops the state; a late status response for an old open is ignored', async () => {
    const gate: { release: (s: SourceControlStatus) => void } = { release: () => undefined }
    const { flow } = setup({
      status: () =>
        new Promise<SourceControlStatus>((resolve) => {
          gate.release = resolve
        })
    })
    const opening = flow.open('r::/w')
    flow.close()
    gate.release(status())
    await opening
    expect(flow.view().phase).toBe('hidden')
  })
})

describe('source control flow — review', () => {
  const reviewOf = (view: SourceControlView) => ready(view).review

  it('asks the host for eligibility with the git state and an opaque repo selector', async () => {
    const { flow, gateway } = setup()
    await flow.open('r::/w')
    expect(gateway.hostedReviewEligibility).toHaveBeenCalledWith({
      repo: 'id:r',
      worktree: 'r::/w',
      branch: 'feat',
      base: null,
      hasUncommittedChanges: true,
      hasUpstream: true,
      ahead: 1,
      behind: 0
    })
  })

  it('derives the base from the parent node branch', async () => {
    const { flow, gateway, store } = setup()
    store.update({
      graph: buildWorktreeGraph([
        {
          id: 'r::/main',
          repoId: 'r',
          branch: 'refs/heads/develop',
          parentWorktreeId: null,
          childWorktreeIds: ['r::/w'],
          workspaceStatus: 'in-progress',
          git: { path: '/main', isMainWorktree: true }
        },
        {
          id: 'r::/w',
          repoId: 'r',
          branch: 'refs/heads/feat',
          parentWorktreeId: 'r::/main',
          childWorktreeIds: [],
          workspaceStatus: 'in-progress',
          git: { path: '/w', isMainWorktree: false }
        }
      ])
    })
    await flow.open('r::/w')
    expect(gateway.hostedReviewEligibility).toHaveBeenCalledWith(
      expect.objectContaining({ base: 'develop' })
    )
  })

  it('prefills the form from the eligibility reply', async () => {
    const { flow } = setup()
    await flow.open('r::/w')
    const review = reviewOf(flow.view())
    expect(review).toMatchObject({ phase: 'ready', title: 'Add x', body: 'Body', draft: false })
  })

  it('degrades to unavailable when eligibility fails', async () => {
    const { flow, gateway } = setup()
    gateway.hostedReviewEligibility.mockRejectedValue(new Error('no remote'))
    await flow.open('r::/w')
    expect(reviewOf(flow.view()).phase).toBe('unavailable')
    expect(flow.view().phase).toBe('ready')
  })

  it('keeps user edits across an eligibility reload', async () => {
    const { flow } = setup()
    await flow.open('r::/w')
    flow.setReviewForm({ title: 'My title', draft: true })
    await flow.toggleStage('b.ts')
    expect(reviewOf(flow.view())).toMatchObject({ title: 'My title', draft: true })
  })

  it('creates the review with the opaque provider and form values, then reloads eligibility', async () => {
    const { flow, gateway } = setup({ eligibility: eligibility({ provider: 'future-forge' }) })
    await flow.open('r::/w')
    flow.setReviewForm({ draft: true })
    await flow.reviewPrimary()
    expect(gateway.hostedReviewCreate).toHaveBeenCalledWith({
      repo: 'id:r',
      worktree: 'r::/w',
      provider: 'future-forge',
      base: 'main',
      head: 'feat',
      title: 'Add x',
      body: 'Body',
      draft: true
    })
    const review = reviewOf(flow.view())
    expect(review).toMatchObject({
      phase: 'ready',
      result: { tone: 'ok', href: 'https://x/pull/12' }
    })
    expect(gateway.hostedReviewEligibility).toHaveBeenCalledTimes(2)
  })

  it('does not create without a title', async () => {
    const { flow, gateway } = setup()
    await flow.open('r::/w')
    flow.setReviewForm({ title: '  ' })
    await flow.reviewPrimary()
    expect(gateway.hostedReviewCreate).not.toHaveBeenCalled()
  })

  it('leads with the actionable message on auth_required and keeps the host error as detail', async () => {
    const { flow, gateway } = setup()
    gateway.hostedReviewCreate.mockResolvedValueOnce({
      ok: false,
      code: 'auth_required',
      error: 'gh: not logged in'
    })
    await flow.open('r::/w')
    await flow.reviewPrimary()
    expect(reviewOf(flow.view())).toMatchObject({
      result: {
        tone: 'error',
        message: { lead: authRequiredMessage(), detail: 'gh: not logged in' }
      }
    })
  })

  it('links the existing review on already_exists and leads other codes with their copy', async () => {
    const { flow, gateway } = setup()
    gateway.hostedReviewCreate
      .mockResolvedValueOnce({
        ok: false,
        code: 'already_exists',
        error: 'exists',
        existingReview: { number: 3, url: 'https://x/3' }
      })
      .mockResolvedValueOnce({ ok: false, code: 'validation', error: 'title too long' })
    await flow.open('r::/w')
    await flow.reviewPrimary()
    expect(reviewOf(flow.view())).toMatchObject({ result: { href: 'https://x/3' } })
    await flow.reviewPrimary()
    expect(reviewOf(flow.view())).toMatchObject({
      result: { message: { lead: 'el proveedor rechazó el pedido', detail: 'title too long' } }
    })
    setActiveLanguage('en')
    try {
      expect(describeFailure('reviewCreate', 'title too long', 'validation')).toEqual({
        lead: 'the provider rejected the request',
        detail: 'title too long'
      })
    } finally {
      setActiveLanguage('es')
    }
  })

  it('routes the primary button by nextAction', async () => {
    const publish = setup({
      eligibility: eligibility({ canCreate: false, nextAction: 'publish' }),
      status: async () => status({ hasUpstream: false, ahead: 0 })
    })
    await publish.flow.open('r::/w')
    await publish.flow.reviewPrimary()
    expect(publish.gateway.gitPush).toHaveBeenCalledWith('r::/w', { publish: true })

    const sync = setup({ eligibility: eligibility({ canCreate: false, nextAction: 'sync' }) })
    await sync.flow.open('r::/w')
    await sync.flow.reviewPrimary()
    expect(ready(sync.flow.view()).notice?.message.lead).toMatch(/pull|rebase/)

    const auth = setup({
      eligibility: eligibility({ canCreate: false, nextAction: 'authenticate' })
    })
    await auth.flow.open('r::/w')
    await auth.flow.reviewPrimary()
    expect(ready(auth.flow.view()).notice?.message.lead).toBe(authRequiredMessage())

    const commit = setup({ eligibility: eligibility({ canCreate: false, nextAction: 'commit' }) })
    await commit.flow.open('r::/w')
    await commit.flow.reviewPrimary()
    expect(commit.gateway.gitCommit).not.toHaveBeenCalled()
    expect(ready(commit.flow.view()).notice?.tone).toBe('error')
  })
})
