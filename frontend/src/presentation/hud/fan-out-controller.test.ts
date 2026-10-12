import { describe, expect, it, vi } from 'vitest'
import { createFanOutController } from './fan-out-controller'
import type { FanOutControllerDeps } from './fan-out-controller'
import { emptyFanOutSlice } from '../../application/fan-out-model'
import type { FanOutAction, FanOutSlice } from '../../application/fan-out-model'
import type {
  runCamadaLeaseSubmit,
  FanOutLeaseSubmitResult
} from '../../application/fan-out-lease-submit'
import type {
  CreateWorktreeInput,
  CreateWorktreeResult,
  LeaseGateListInput,
  LeaseGateListResult,
  LeaseGateResolveInput,
  LeaseGateResolveResult,
  LeaseQuestionAnswerInput,
  LeaseQuestionAnswerResult,
  LeaseQuestionListInput,
  LeaseQuestionListResult,
  LeaseRunCreateInput,
  LeaseRunCreateResult,
  LeaseTaskCreateInput,
  LeaseTaskCreateResult,
  LeaseWorkerListInput,
  LeaseWorkerListResult,
  LeaseWorkerShowInput,
  LeaseWorkerShowResult,
  LeaseWorkerStartInput,
  LeaseWorkerStartResult,
  RepoSummary,
  WorktreePsRow
} from '../../application/ports/runtime-gateway'
import type { FanOutFormHandle } from './fan-out-element'
import { emptyWorktreeGraph } from '../../domain/worktree-graph/types'
import type { WorktreeGraph, WorktreeId, WorktreeNode } from '../../domain/worktree-graph/types'
import { inertActivity } from '../../domain/worktree-graph/node-activity'

/** Graph whose only node `w1` belongs to `repoId` — the parent the litter is anchored on. */
const graphWithParent = (repoId: string): WorktreeGraph => {
  const parent: WorktreeNode = {
    id: 'w1',
    repoId,
    branch: 'refs/heads/master',
    path: '/wt/w1',
    status: 'in-progress',
    isMain: true,
    kind: 'root',
    parentId: null,
    childIds: [],
    activity: inertActivity()
  }
  return { ...emptyWorktreeGraph(), nodes: new Map([[parent.id, parent]]), rootIds: ['w1'] }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

type FakeForm = FanOutFormHandle & {
  disposed: boolean
  emitCountChange(count: number): void
  emitAgentChange(agent: 'none' | 'claude'): void
  emitPromptChange(prompt: string): void
  emitSubmit(): void
  emitCancel(): void
  emitDismiss(): void
  emitResolveGate(gateId: string, resolution: string): Promise<void> | void
  emitAnswerQuestion(messageId: string, body: string): Promise<void> | void
}

const createFakeForm = (): FakeForm => {
  let countCb: ((count: number) => void) | null = null
  let agentCb: ((agent: 'none' | 'claude') => void) | null = null
  let promptCb: ((prompt: string) => void) | null = null
  let submitCb: (() => void) | null = null
  let cancelCb: (() => void) | null = null
  let dismissCb: (() => void) | null = null
  let resolveGateCb: ((gateId: string, resolution: string) => void | Promise<void>) | null = null
  let answerQuestionCb: ((messageId: string, body: string) => void | Promise<void>) | null = null
  const form: FakeForm = {
    element: {} as HTMLElement,
    disposed: false,
    apply: vi.fn(),
    onCountChange(cb) {
      countCb = cb
      return () => (countCb = null)
    },
    onAgentChange(cb) {
      agentCb = cb
      return () => (agentCb = null)
    },
    onPromptChange(cb) {
      promptCb = cb
      return () => (promptCb = null)
    },
    onSubmit(cb) {
      submitCb = cb
      return () => (submitCb = null)
    },
    onCancel(cb) {
      cancelCb = cb
      return () => (cancelCb = null)
    },
    onDismiss(cb) {
      dismissCb = cb
      return () => (dismissCb = null)
    },
    setVisible: vi.fn(),
    onResolveGate(cb) {
      resolveGateCb = cb
      return () => (resolveGateCb = null)
    },
    onAnswerQuestion(cb) {
      answerQuestionCb = cb
      return () => (answerQuestionCb = null)
    },
    focusFirstField: vi.fn(),
    dispose: vi.fn(() => (form.disposed = true)),
    emitCountChange(count) {
      countCb?.(count)
    },
    emitAgentChange(agent) {
      agentCb?.(agent)
    },
    emitPromptChange(prompt) {
      promptCb?.(prompt)
    },
    emitSubmit() {
      submitCb?.()
    },
    emitCancel() {
      cancelCb?.()
    },
    emitDismiss() {
      dismissCb?.()
    },
    emitResolveGate(gateId, resolution) {
      return resolveGateCb?.(gateId, resolution)
    },
    emitAnswerQuestion(messageId, body) {
      return answerQuestionCb?.(messageId, body)
    }
  }
  return form
}

const createFakeGateway = () => ({
  listRepos: vi.fn<() => Promise<readonly RepoSummary[]>>(async () => [
    { id: 'repo-1', path: '/repo-1', displayName: 'Repo One', kind: 'git' }
  ]),
  createWorktree: vi.fn<(input: CreateWorktreeInput) => Promise<CreateWorktreeResult>>(
    async () => ({ worktreeId: 'wt-1' })
  ),
  listWorktreePs: vi.fn<() => Promise<readonly WorktreePsRow[]>>(async () => []),
  repoSetupCommand: vi.fn<(repo: string) => Promise<string | null>>(async () => null),
  orchestrationRunCreate: vi.fn<(input: LeaseRunCreateInput) => Promise<LeaseRunCreateResult>>(
    async () => {
      throw new Error('orchestrationRunCreate not implemented in this fake')
    }
  ),
  orchestrationTaskCreate: vi.fn<(input: LeaseTaskCreateInput) => Promise<LeaseTaskCreateResult>>(
    async () => {
      throw new Error('orchestrationTaskCreate not implemented in this fake')
    }
  ),
  orchestrationWorkerStart: vi.fn<
    (input: LeaseWorkerStartInput) => Promise<LeaseWorkerStartResult>
  >(async () => {
    throw new Error('orchestrationWorkerStart not implemented in this fake')
  }),
  orchestrationWorkerList: vi.fn<(input: LeaseWorkerListInput) => Promise<LeaseWorkerListResult>>(
    async () => ({ workers: [] })
  ),
  orchestrationWorkerShow: vi.fn<(input: LeaseWorkerShowInput) => Promise<LeaseWorkerShowResult>>(
    async () => ({ awaitingInput: null })
  ),
  orchestrationGateList: vi.fn<(input: LeaseGateListInput) => Promise<LeaseGateListResult>>(
    async () => ({ gates: [] })
  ),
  orchestrationGateResolve: vi.fn<
    (input: LeaseGateResolveInput) => Promise<LeaseGateResolveResult>
  >(async () => {
    throw new Error('orchestrationGateResolve not implemented in this fake')
  }),
  orchestrationQuestionList: vi.fn<
    (input: LeaseQuestionListInput) => Promise<LeaseQuestionListResult>
  >(async () => ({ questions: [] })),
  orchestrationQuestionAnswer: vi.fn<
    (input: LeaseQuestionAnswerInput) => Promise<LeaseQuestionAnswerResult>
  >(async () => {
    throw new Error('orchestrationQuestionAnswer not implemented in this fake')
  })
})

const createFakePoll = () => ({
  start: vi.fn(),
  stop: vi.fn(),
  rebindGateway: vi.fn()
})

const setup = (overrides: Partial<FanOutControllerDeps> = {}) => {
  const gateway = createFakeGateway()
  const forms: FakeForm[] = []
  const hud = { appendChild: vi.fn() }
  const dispatch = vi.fn<(action: FanOutAction) => void>()
  const refetch = vi.fn(async () => {})
  const focusLitter = vi.fn<(memberIds: readonly WorktreeId[]) => void>()
  const memberPoll = createFakePoll()
  let mutationCounter = 0
  const deps: FanOutControllerDeps = {
    gateway,
    createElement: () => {
      const f = createFakeForm()
      forms.push(f)
      return f
    },
    hud,
    dispatch,
    focusLitter,
    memberPoll,
    refetch,
    generateMutationId: () => `mutation-${++mutationCounter}`,
    ...overrides
  }
  const controller = createFanOutController(deps)
  return { controller, gateway, forms, hud, dispatch, refetch, focusLitter, memberPoll, deps }
}

const formSlice = (
  overrides: Partial<Extract<FanOutSlice, { view: 'form' }>> = {}
): FanOutSlice => ({
  view: 'form',
  parentId: 'w1',
  fields: { count: 3, agent: 'none', prompt: '' },
  repoSelector: null,
  ...overrides
})

describe('createFanOutController', () => {
  it('does nothing when the slice is closed', () => {
    const { controller, forms } = setup()
    controller.sync(emptyFanOutSlice(), emptyWorktreeGraph())
    expect(forms).toHaveLength(0)
  })

  it('mounts the element into the hud and applies the view model on open', () => {
    const { controller, forms, hud } = setup()
    controller.sync(formSlice(), emptyWorktreeGraph())
    expect(forms).toHaveLength(1)
    expect(hud.appendChild).toHaveBeenCalledWith(forms[0]!.element)
    expect(forms[0]!.apply).toHaveBeenCalled()
  })

  it('probes the target repo setup once and re-applies the form with the no-setup hint', async () => {
    const { controller, gateway, forms } = setup()
    const slice = formSlice({ repoSelector: 'id:repo-1' })
    controller.sync(slice, emptyWorktreeGraph())
    controller.sync(slice, emptyWorktreeGraph())
    await flush()
    expect(gateway.repoSetupCommand).toHaveBeenCalledOnce()
    expect(forms[0]!.apply).toHaveBeenLastCalledWith(
      expect.objectContaining({ setupHint: expect.stringContaining('sin setup') })
    )
  })

  it('focuses the first field on the closed -> form transition', () => {
    const { controller, forms } = setup()
    controller.sync(emptyFanOutSlice(), emptyWorktreeGraph())
    controller.sync(formSlice(), emptyWorktreeGraph())
    expect(forms[0]!.focusFirstField).toHaveBeenCalledOnce()
  })

  // Why: the litter must land in the PARENT's repo, never the active one (see spawn-menu-controller).
  it('resolves the repo selector from the parent node repoId without listing repos', async () => {
    const { controller, gateway, dispatch } = setup()
    controller.sync(formSlice(), graphWithParent('repo-parent'))
    await flush()
    expect(gateway.listRepos).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith({
      type: 'set-repo-selector',
      repoSelector: 'id:repo-parent'
    })
  })

  it('re-derives a cached selector that belongs to another repo than the parent', async () => {
    const { controller, gateway, dispatch } = setup()
    controller.sync(formSlice({ repoSelector: 'id:repo-stale' }), graphWithParent('repo-parent'))
    await flush()
    expect(gateway.listRepos).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith({
      type: 'set-repo-selector',
      repoSelector: 'id:repo-parent'
    })
  })

  it('fetches repos exactly once on first open and resolves the repo selector, preferring activeRepoId', async () => {
    const gateway = createFakeGateway()
    gateway.listRepos.mockResolvedValueOnce([
      { id: 'repo-1', path: '/repo-1', displayName: 'Repo One', kind: 'git' },
      { id: 'repo-2', path: '/repo-2', displayName: 'Repo Two', kind: 'git' }
    ])
    const dispatch = vi.fn<(action: FanOutAction) => void>()
    const controller = createFanOutController({
      gateway,
      createElement: () => createFakeForm(),
      hud: { appendChild: vi.fn() },
      dispatch,
      focusLitter: vi.fn(),
      memberPoll: createFakePoll(),
      refetch: vi.fn(async () => {}),
      activeRepoId: () => 'repo-2'
    })
    controller.sync(formSlice(), emptyWorktreeGraph())
    await flush()
    expect(gateway.listRepos).toHaveBeenCalledOnce()
    expect(dispatch).toHaveBeenCalledWith({ type: 'set-repo-selector', repoSelector: 'id:repo-2' })
  })

  it('falls back to the first listed repo when activeRepoId is not provided', async () => {
    const { controller, dispatch } = setup()
    controller.sync(formSlice(), emptyWorktreeGraph())
    await flush()
    expect(dispatch).toHaveBeenCalledWith({ type: 'set-repo-selector', repoSelector: 'id:repo-1' })
  })

  it('does not refetch repos once the slice already carries a resolved repoSelector', async () => {
    const { controller, gateway } = setup()
    controller.sync(formSlice({ repoSelector: 'id:repo-1' }), emptyWorktreeGraph())
    await flush()
    expect(gateway.listRepos).not.toHaveBeenCalled()
  })

  it('wires count/agent/prompt field changes to their dispatch actions', () => {
    const { controller, forms, dispatch } = setup()
    controller.sync(formSlice(), emptyWorktreeGraph())
    forms[0]!.emitCountChange(5)
    expect(dispatch).toHaveBeenCalledWith({ type: 'update-count', count: 5 })
    forms[0]!.emitAgentChange('claude')
    expect(dispatch).toHaveBeenCalledWith({ type: 'update-agent', agent: 'claude' })
    forms[0]!.emitPromptChange('hola')
    expect(dispatch).toHaveBeenCalledWith({ type: 'update-prompt', prompt: 'hola' })
  })

  it('wires cancel from the element to a cancel dispatch', () => {
    const { controller, forms, dispatch } = setup()
    controller.sync(formSlice(), emptyWorktreeGraph())
    forms[0]!.emitCancel()
    expect(dispatch).toHaveBeenCalledWith({ type: 'cancel' })
  })

  it('repo-unresolved guard: dispatches form-error and makes zero createWorktree calls', async () => {
    const { controller, gateway, forms, dispatch } = setup()
    controller.sync(formSlice({ repoSelector: null }), emptyWorktreeGraph())
    forms[0]!.emitSubmit()
    await flush()
    expect(gateway.createWorktree).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith({
      type: 'form-error',
      message: { lead: expect.any(String), detail: null }
    })
  })

  it('submit: generates N distinct mutation ids and dispatches submit first', async () => {
    const { controller, forms, dispatch } = setup()
    controller.sync(
      formSlice({ repoSelector: 'id:repo-1', fields: { count: 3, agent: 'none', prompt: '' } }),
      emptyWorktreeGraph()
    )
    forms[0]!.emitSubmit()
    expect(dispatch).toHaveBeenCalledWith({
      type: 'submit',
      mutationIds: ['mutation-1', 'mutation-2', 'mutation-3']
    })
    await flush()
  })

  it('submit: calls createWorktree sequentially (not in parallel), in mutation-id order', async () => {
    const { controller, gateway, forms } = setup()
    const order: string[] = []
    gateway.createWorktree.mockImplementation(async (input) => {
      order.push(`start:${input.clientMutationId}`)
      await Promise.resolve()
      order.push(`end:${input.clientMutationId}`)
      return { worktreeId: `wt-${input.clientMutationId}` }
    })
    controller.sync(
      formSlice({ repoSelector: 'id:repo-1', fields: { count: 3, agent: 'none', prompt: '' } }),
      emptyWorktreeGraph()
    )
    forms[0]!.emitSubmit()
    await flush()
    expect(order).toEqual([
      'start:mutation-1',
      'end:mutation-1',
      'start:mutation-2',
      'end:mutation-2',
      'start:mutation-3',
      'end:mutation-3'
    ])
  })

  it('submit: dispatches child-created on success', async () => {
    const { controller, gateway, forms, dispatch } = setup()
    gateway.createWorktree.mockResolvedValueOnce({ worktreeId: 'wt-1' })
    controller.sync(
      formSlice({ repoSelector: 'id:repo-1', fields: { count: 2, agent: 'none', prompt: '' } }),
      emptyWorktreeGraph()
    )
    forms[0]!.emitSubmit()
    await flush()
    expect(dispatch).toHaveBeenCalledWith({
      type: 'child-created',
      mutationId: 'mutation-1',
      worktreeId: 'wt-1'
    })
  })

  it('submit: continue-on-error — a rejection dispatches child-failed and the loop continues', async () => {
    const { controller, gateway, forms, dispatch } = setup()
    gateway.createWorktree
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ worktreeId: 'wt-2' })
    controller.sync(
      formSlice({ repoSelector: 'id:repo-1', fields: { count: 2, agent: 'none', prompt: '' } }),
      emptyWorktreeGraph()
    )
    forms[0]!.emitSubmit()
    await flush()
    expect(gateway.createWorktree).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenCalledWith({
      type: 'child-failed',
      mutationId: 'mutation-1',
      message: { lead: 'no se pudo crear este worktree', detail: 'boom' }
    })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'child-created',
      mutationId: 'mutation-2',
      worktreeId: 'wt-2'
    })
  })

  it('submit: after the loop, frames the camera on the litter and starts the member poll', async () => {
    const { controller, gateway, forms, focusLitter, memberPoll, refetch } = setup()
    gateway.createWorktree
      .mockResolvedValueOnce({ worktreeId: 'wt-a' })
      .mockRejectedValueOnce(new Error('boom'))
    controller.sync(
      formSlice({
        parentId: 'parent-1',
        repoSelector: 'id:repo-1',
        fields: { count: 2, agent: 'none', prompt: '' }
      }),
      emptyWorktreeGraph()
    )
    forms[0]!.emitSubmit()
    await flush()
    expect(focusLitter).toHaveBeenCalledWith(['parent-1', 'wt-a'])
    expect(memberPoll.start).toHaveBeenCalledOnce()
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('close/cancel: stops the member poll and unmounts the element', () => {
    const { controller, forms, memberPoll } = setup()
    controller.sync(formSlice(), emptyWorktreeGraph())
    controller.sync(emptyFanOutSlice(), emptyWorktreeGraph())
    expect(memberPoll.stop).toHaveBeenCalled()
    expect(forms[0]!.disposed).toBe(true)
  })

  it('rebindGateway rebinds both the controller gateway and the member poll gateway', async () => {
    const { controller, forms, memberPoll } = setup()
    const newGateway = createFakeGateway()
    controller.rebindGateway(newGateway)
    expect(memberPoll.rebindGateway).toHaveBeenCalledWith(newGateway)

    controller.sync(
      formSlice({ repoSelector: 'id:repo-1', fields: { count: 2, agent: 'none', prompt: '' } }),
      emptyWorktreeGraph()
    )
    forms[0]!.emitSubmit()
    await flush()
    expect(newGateway.createWorktree).toHaveBeenCalledTimes(2)
  })

  it('dispose unmounts the element and stops the member poll', () => {
    const { controller, forms, memberPoll } = setup()
    controller.sync(formSlice(), emptyWorktreeGraph())
    controller.dispose()
    expect(forms[0]!.disposed).toBe(true)
    expect(memberPoll.stop).toHaveBeenCalled()
  })
})

const leaseResult = (
  overrides: Partial<FanOutLeaseSubmitResult> = {}
): FanOutLeaseSubmitResult => ({
  localSlice: {
    view: 'running',
    parentId: 'w1',
    fields: { count: 2, agent: 'claude', prompt: 'fix the bug' },
    repoSelector: 'id:repo-1',
    batch: [
      {
        mutationId: 'mutation-1',
        worktreeId: 'wt-lease',
        failed: false,
        dispatchId: 'dispatch-1',
        taskId: 'task-1'
      },
      {
        mutationId: 'mutation-2',
        worktreeId: 'wt-lease-2',
        failed: false,
        dispatchId: 'dispatch-2',
        taskId: 'task-2'
      }
    ],
    memberStatus: {},
    runId: 'run-1'
  },
  runCreateFailed: false,
  ...overrides
})

describe('createFanOutController — lease path (Change B)', () => {
  it('uses the lease planner when leaseCapable() and an agent is chosen — threads ids into focus/poll/refetch', async () => {
    const leasePlanner = vi.fn<typeof runCamadaLeaseSubmit>(async () => leaseResult())
    const { controller, gateway, forms, focusLitter, memberPoll, refetch } = setup({
      leaseCapable: () => true,
      leasePlanner
    })
    controller.sync(
      formSlice({
        repoSelector: 'id:repo-1',
        fields: { count: 2, agent: 'claude', prompt: 'fix the bug' }
      }),
      emptyWorktreeGraph()
    )
    forms[0]!.emitSubmit()
    await flush()

    expect(leasePlanner).toHaveBeenCalledOnce()
    const [passedSlice, passedRepo, passedMutationIds, passedDeps] = leasePlanner.mock.calls[0]!
    expect(passedSlice.view).toBe('form')
    expect(passedRepo).toBe('id:repo-1')
    expect(passedMutationIds).toEqual(['mutation-1', 'mutation-2'])
    expect(passedDeps.gateway).toBe(gateway)
    expect(gateway.createWorktree).not.toHaveBeenCalled()
    expect(focusLitter).toHaveBeenCalledWith(['w1', 'wt-lease', 'wt-lease-2'])
    expect(memberPoll.start).toHaveBeenCalledOnce()
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('blank prompt with an agent: dispatches form-error and never reaches the planner nor createWorktree', async () => {
    const leasePlanner = vi.fn<typeof runCamadaLeaseSubmit>(async () => leaseResult())
    const { controller, gateway, forms, dispatch, memberPoll } = setup({
      leaseCapable: () => true,
      leasePlanner
    })
    controller.sync(
      formSlice({ repoSelector: 'id:repo-1', fields: { count: 2, agent: 'claude', prompt: '  ' } }),
      emptyWorktreeGraph()
    )
    forms[0]!.emitSubmit()
    await flush()

    expect(dispatch).toHaveBeenCalledWith({
      type: 'form-error',
      message: { lead: expect.any(String), detail: null }
    })
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'submit' }))
    expect(leasePlanner).not.toHaveBeenCalled()
    expect(gateway.createWorktree).not.toHaveBeenCalled()
    expect(memberPoll.start).not.toHaveBeenCalled()
  })

  it('falls back to the v1 loop when leaseCapable() is false, even with an agent chosen', async () => {
    const leasePlanner = vi.fn<typeof runCamadaLeaseSubmit>(async () => leaseResult())
    const { controller, gateway, forms } = setup({ leaseCapable: () => false, leasePlanner })
    controller.sync(
      formSlice({
        repoSelector: 'id:repo-1',
        fields: { count: 2, agent: 'claude', prompt: 'fix the bug' }
      }),
      emptyWorktreeGraph()
    )
    forms[0]!.emitSubmit()
    await flush()
    expect(leasePlanner).not.toHaveBeenCalled()
    expect(gateway.createWorktree).toHaveBeenCalledTimes(2)
  })

  it('falls back to the v1 loop when the agent is none, even with leaseCapable() true', async () => {
    const leasePlanner = vi.fn<typeof runCamadaLeaseSubmit>(async () => leaseResult())
    const { controller, gateway, forms } = setup({ leaseCapable: () => true, leasePlanner })
    controller.sync(
      formSlice({ repoSelector: 'id:repo-1', fields: { count: 2, agent: 'none', prompt: '' } }),
      emptyWorktreeGraph()
    )
    forms[0]!.emitSubmit()
    await flush()
    expect(leasePlanner).not.toHaveBeenCalled()
    expect(gateway.createWorktree).toHaveBeenCalledTimes(2)
  })

  it('a runCreate failure falls back to the v1 loop, still using the ids seeded by the planner', async () => {
    const leasePlanner = vi.fn<typeof runCamadaLeaseSubmit>(async () =>
      leaseResult({
        runCreateFailed: true,
        localSlice: {
          view: 'running',
          parentId: 'w1',
          fields: { count: 2, agent: 'claude', prompt: 'fix the bug' },
          repoSelector: 'id:repo-1',
          batch: [
            {
              mutationId: 'mutation-1',
              worktreeId: null,
              failed: false,
              dispatchId: null,
              taskId: null
            },
            {
              mutationId: 'mutation-2',
              worktreeId: null,
              failed: false,
              dispatchId: null,
              taskId: null
            }
          ],
          memberStatus: {},
          runId: null
        }
      })
    )
    const { controller, gateway, forms, focusLitter } = setup({
      leaseCapable: () => true,
      leasePlanner
    })
    gateway.createWorktree.mockResolvedValueOnce({ worktreeId: 'wt-v1-fallback' })
    controller.sync(
      formSlice({
        repoSelector: 'id:repo-1',
        fields: { count: 2, agent: 'claude', prompt: 'fix the bug' }
      }),
      emptyWorktreeGraph()
    )
    forms[0]!.emitSubmit()
    await flush()

    expect(leasePlanner).toHaveBeenCalledOnce()
    expect(gateway.createWorktree).toHaveBeenCalledTimes(2)
    expect(focusLitter).toHaveBeenCalledWith(['w1', 'wt-v1-fallback', 'wt-1'])
  })
})

const runningLeaseSlice = (
  overrides: Partial<Extract<FanOutSlice, { view: 'running' }>> = {}
): FanOutSlice => ({
  view: 'running',
  parentId: 'w1',
  fields: { count: 2, agent: 'claude', prompt: 'fix the bug' },
  repoSelector: 'id:repo-1',
  batch: [
    {
      mutationId: 'mutation-1',
      worktreeId: 'wt-1',
      failed: false,
      dispatchId: 'dispatch-1',
      taskId: 'task-1'
    }
  ],
  memberStatus: {},
  runId: 'run-1',
  ...overrides
})

describe('createFanOutController — gate resolve / question answer (Change F)', () => {
  it('resolve: routes to orchestrationGateResolve scoped to the running runId, then refetches', async () => {
    const { controller, gateway, forms, refetch } = setup()
    controller.sync(runningLeaseSlice(), emptyWorktreeGraph())
    gateway.orchestrationGateResolve.mockResolvedValueOnce({
      gate: {
        id: 'gate-1',
        runId: 'run-1',
        taskId: 'task-1',
        question: 'q',
        options: '[]',
        status: 'resolved',
        resolution: 'a',
        createdAt: '',
        resolvedAt: ''
      }
    })
    await forms[0]!.emitResolveGate('gate-1', 'a')
    expect(gateway.orchestrationGateResolve).toHaveBeenCalledWith({
      run: 'run-1',
      gateId: 'gate-1',
      resolution: 'a'
    })
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('answer: routes to orchestrationQuestionAnswer scoped to the running runId, then refetches', async () => {
    const { controller, gateway, forms, refetch } = setup()
    controller.sync(runningLeaseSlice(), emptyWorktreeGraph())
    gateway.orchestrationQuestionAnswer.mockResolvedValueOnce({
      messageId: 'msg-2',
      duplicate: false
    })
    await forms[0]!.emitAnswerQuestion('msg-1', 'go with a')
    expect(gateway.orchestrationQuestionAnswer).toHaveBeenCalledWith({
      run: 'run-1',
      messageId: 'msg-1',
      body: 'go with a'
    })
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('a gateway throw on resolve propagates to the caller (the row shows it inline) without dispatching or crashing', async () => {
    const { controller, gateway, forms, dispatch } = setup()
    controller.sync(runningLeaseSlice(), emptyWorktreeGraph())
    gateway.orchestrationGateResolve.mockRejectedValueOnce(new Error('gate_not_pending'))
    await expect(forms[0]!.emitResolveGate('gate-1', 'a')).rejects.toThrow('gate_not_pending')
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'cancel' }))
    expect(forms[0]!.disposed).toBe(false)
  })

  it('a gateway throw on answer propagates to the caller without dispatching or crashing', async () => {
    const { controller, gateway, forms } = setup()
    controller.sync(runningLeaseSlice(), emptyWorktreeGraph())
    gateway.orchestrationQuestionAnswer.mockRejectedValueOnce(new Error('answer_conflict'))
    await expect(forms[0]!.emitAnswerQuestion('msg-1', 'go with a')).rejects.toThrow(
      'answer_conflict'
    )
    expect(forms[0]!.disposed).toBe(false)
  })

  it('is a defensive no-op (no gateway call) when the running batch has no lease runId (v1 path)', async () => {
    const { controller, gateway, forms } = setup()
    controller.sync(runningLeaseSlice({ runId: null }), emptyWorktreeGraph())
    await forms[0]!.emitResolveGate('gate-1', 'a')
    await forms[0]!.emitAnswerQuestion('msg-1', 'body')
    expect(gateway.orchestrationGateResolve).not.toHaveBeenCalled()
    expect(gateway.orchestrationQuestionAnswer).not.toHaveBeenCalled()
  })

  it('not capable: the running model carries no gates/questions when decisionVisibility never populated — rows never render', () => {
    const { controller, forms } = setup()
    controller.sync(runningLeaseSlice(), emptyWorktreeGraph())
    const applied = forms[0]!.apply as unknown as {
      mock: { calls: [{ view: string; gates?: unknown[]; questions?: unknown[] }][] }
    }
    const lastModel = applied.mock.calls.at(-1)![0]
    expect(lastModel.gates).toEqual([])
    expect(lastModel.questions).toEqual([])
  })
})

describe('createFanOutController — running panel visibility', () => {
  const visibleCalls = (form: FakeForm) =>
    (form.setVisible as ReturnType<typeof vi.fn>).mock.calls.map(([v]) => v)

  it('shows a busy litter and hides it once dismissed, until the next run', () => {
    const { controller, forms } = setup()
    const graph = graphWithParent('repo-1')
    controller.sync(runningLeaseSlice(), graph)
    expect(visibleCalls(forms[0]!).at(-1)).toBe(true)
    forms[0]!.emitDismiss()
    expect(visibleCalls(forms[0]!).at(-1)).toBe(false)
    controller.sync(runningLeaseSlice(), graph)
    expect(visibleCalls(forms[0]!).at(-1)).toBe(false)
    controller.sync(emptyFanOutSlice(), graph)
    controller.sync(runningLeaseSlice(), graph)
    expect(visibleCalls(forms.at(-1)!).at(-1)).toBe(true)
  })

  it('hides itself when an agent none litter has settled', () => {
    const { controller, forms } = setup()
    controller.sync(
      runningLeaseSlice({ fields: { count: 1, agent: 'none', prompt: '' }, runId: null }),
      graphWithParent('repo-1')
    )
    expect(visibleCalls(forms[0]!).at(-1)).toBe(false)
  })

  it('only shows on the island of the parent repo', () => {
    let active: string | null = 'repo-2'
    const { controller, forms } = setup({ activeRepoId: () => active })
    const graph = graphWithParent('repo-1')
    controller.sync(runningLeaseSlice(), graph)
    expect(visibleCalls(forms[0]!).at(-1)).toBe(false)
    active = 'repo-1'
    controller.sync(runningLeaseSlice(), graph)
    expect(visibleCalls(forms[0]!).at(-1)).toBe(true)
  })
})
