import { plainFailure } from './i18n/user-facing-error'
import { describe, expect, it } from 'vitest'
import {
  FANOUT_PLACEHOLDER_PREFIX,
  fanOutPromptRequiredMessage,
  MAX_FANOUT,
  MIN_FANOUT,
  clampFanOutCount,
  composeFanOutGraph,
  emptyFanOutSlice,
  fanOutCounts,
  fanOutDecisionCounts,
  fanOutMemberIds,
  fanOutParentId,
  fanOutSettled,
  fanOutObjectiveText,
  fanOutSubmitBlocker,
  isFailedDispatch,
  mapDispatchStateToAgentStatus,
  mapPsStatusToAgentStatus,
  reduceFanOut,
  toFanOutInputs
} from './fan-out-model'
import type { FanOutBatchEntry, FanOutSlice } from './fan-out-model'
import type { LeaseGateRow, LeaseQuestionRow } from './ports/runtime-gateway'
import { childrenOf } from '../domain/worktree-graph/graph-traversal'
import { inertActivity } from '../domain/worktree-graph/node-activity'
import type { WorktreeGraph, WorktreeNode } from '../domain/worktree-graph/types'

const node = (overrides: Partial<WorktreeNode> = {}): WorktreeNode => ({
  id: 'repo::/path/parent',
  repoId: 'repo',
  branch: 'refs/heads/main',
  path: '/path/parent',
  status: 'in-progress',
  isMain: true,
  kind: 'root',
  parentId: null,
  childIds: [],
  activity: inertActivity(),
  ...overrides
})

const graphOf = (nodes: readonly WorktreeNode[]): WorktreeGraph => ({
  nodes: new Map(nodes.map((n) => [n.id, n])),
  edges: [],
  rootIds: nodes.filter((n) => n.parentId === null).map((n) => n.id)
})

const formSliceWithCount = (count: number): FanOutSlice => ({
  view: 'form',
  parentId: 'w1',
  fields: { count, agent: 'none', prompt: '' },
  repoSelector: null
})

const runningSliceWithBatch = (batch: readonly FanOutBatchEntry[]): FanOutSlice => ({
  view: 'running',
  parentId: 'w1',
  fields: { count: batch.length, agent: 'claude', prompt: '' },
  repoSelector: 'id:repo-a',
  batch,
  memberStatus: {},
  runId: null
})

describe('emptyFanOutSlice', () => {
  it('starts closed with no repo selector', () => {
    expect(emptyFanOutSlice()).toEqual({ view: 'closed', repoSelector: null })
  })
})

describe('reduceFanOut — open-for-node', () => {
  it('opens a form anchored to the node with a default count of 3', () => {
    const slice = reduceFanOut(emptyFanOutSlice(), { type: 'open-for-node', nodeId: 'w1' })
    expect(slice).toEqual({
      view: 'form',
      parentId: 'w1',
      fields: { count: 3, agent: 'none', prompt: '' },
      repoSelector: null
    })
  })

  it('preserves the repo selector already set', () => {
    const closed: FanOutSlice = { view: 'closed', repoSelector: 'id:repo-a' }
    const slice = reduceFanOut(closed, { type: 'open-for-node', nodeId: 'w1' })
    expect(slice.repoSelector).toBe('id:repo-a')
  })

  it('resets to a fresh form even from a running batch', () => {
    const running: FanOutSlice = {
      view: 'running',
      parentId: 'old',
      fields: { count: 5, agent: 'claude', prompt: 'go' },
      repoSelector: 'id:repo-a',
      batch: [
        { mutationId: 'm1', worktreeId: null, failed: false, dispatchId: null, taskId: null }
      ],
      memberStatus: {},
      runId: null
    }
    const slice = reduceFanOut(running, { type: 'open-for-node', nodeId: 'w2' })
    expect(slice).toEqual({
      view: 'form',
      parentId: 'w2',
      fields: { count: 3, agent: 'none', prompt: '' },
      repoSelector: 'id:repo-a'
    })
  })
})

describe('reduceFanOut — update-count', () => {
  it.each([
    [1, MIN_FANOUT],
    [0, MIN_FANOUT],
    [2, 2],
    [5, 5],
    [8, 8],
    [9, MAX_FANOUT],
    [100, MAX_FANOUT]
  ])('clamps %i to %i', (input, expected) => {
    const slice = reduceFanOut(formSliceWithCount(3), { type: 'update-count', count: input })
    expect(slice).toMatchObject({ fields: { count: expected } })
  })

  it('is a no-op outside the form view', () => {
    const closed = emptyFanOutSlice()
    expect(reduceFanOut(closed, { type: 'update-count', count: 5 })).toBe(closed)
  })
})

describe('reduceFanOut — update-agent / update-prompt', () => {
  const formSlice: FanOutSlice = {
    view: 'form',
    parentId: 'w1',
    fields: { count: 3, agent: 'none', prompt: '' },
    repoSelector: null
  }

  it('merges the agent field in form view', () => {
    const slice = reduceFanOut(formSlice, { type: 'update-agent', agent: 'claude' })
    expect(slice).toMatchObject({ fields: { agent: 'claude', count: 3, prompt: '' } })
  })

  it('merges the prompt field in form view', () => {
    const slice = reduceFanOut(formSlice, { type: 'update-prompt', prompt: 'fix the bug' })
    expect(slice).toMatchObject({ fields: { prompt: 'fix the bug', count: 3, agent: 'none' } })
  })

  it('update-agent is a no-op outside form', () => {
    const closed = emptyFanOutSlice()
    expect(reduceFanOut(closed, { type: 'update-agent', agent: 'claude' })).toBe(closed)
  })

  it('update-prompt is a no-op outside form', () => {
    const closed = emptyFanOutSlice()
    expect(reduceFanOut(closed, { type: 'update-prompt', prompt: 'x' })).toBe(closed)
  })
})

describe('reduceFanOut — set-repo-selector', () => {
  it('is a no-op when closed', () => {
    const closed = emptyFanOutSlice()
    expect(reduceFanOut(closed, { type: 'set-repo-selector', repoSelector: 'id:a' })).toBe(closed)
  })

  it('updates the selector from the form view', () => {
    const formSlice: FanOutSlice = {
      view: 'form',
      parentId: 'w1',
      fields: { count: 3, agent: 'none', prompt: '' },
      repoSelector: null
    }
    const slice = reduceFanOut(formSlice, { type: 'set-repo-selector', repoSelector: 'id:a' })
    expect(slice.repoSelector).toBe('id:a')
  })

  it('updates the selector from the running view', () => {
    const running: FanOutSlice = {
      view: 'running',
      parentId: 'w1',
      fields: { count: 3, agent: 'none', prompt: '' },
      repoSelector: null,
      batch: [],
      memberStatus: {},
      runId: null
    }
    const slice = reduceFanOut(running, { type: 'set-repo-selector', repoSelector: 'id:b' })
    expect(slice.repoSelector).toBe('id:b')
  })
})

describe('reduceFanOut — submit', () => {
  const validForm: FanOutSlice = {
    view: 'form',
    parentId: 'w1',
    fields: { count: 3, agent: 'none', prompt: '' },
    repoSelector: 'id:repo-a'
  }

  it('is a no-op outside the form view', () => {
    const closed = emptyFanOutSlice()
    expect(reduceFanOut(closed, { type: 'submit', mutationIds: ['m1'] })).toBe(closed)
  })

  it('transitions to running with a pending batch entry per mutationId', () => {
    const slice = reduceFanOut(validForm, {
      type: 'submit',
      mutationIds: ['m1', 'm2', 'm3']
    })
    expect(slice).toEqual({
      view: 'running',
      parentId: 'w1',
      fields: { count: 3, agent: 'none', prompt: '' },
      repoSelector: 'id:repo-a',
      batch: [
        { mutationId: 'm1', worktreeId: null, failed: false, dispatchId: null, taskId: null },
        { mutationId: 'm2', worktreeId: null, failed: false, dispatchId: null, taskId: null },
        { mutationId: 'm3', worktreeId: null, failed: false, dispatchId: null, taskId: null }
      ],
      memberStatus: {},
      runId: null,
      decisionVisibility: { gatesByTaskId: {}, questionsByDispatchId: {} }
    })
  })

  it('produces a form-error when the repo selector is missing', () => {
    const slice = reduceFanOut(
      { ...validForm, repoSelector: null },
      { type: 'submit', mutationIds: ['m1'] }
    )
    expect(slice.view).toBe('form')
    expect((slice as { errorMessage?: string }).errorMessage).toBeDefined()
  })

  it('produces a form-error when count is out of bounds', () => {
    const outOfBounds: FanOutSlice = {
      ...validForm,
      fields: { ...validForm.fields, count: 99 }
    }
    const slice = reduceFanOut(outOfBounds, { type: 'submit', mutationIds: ['m1'] })
    expect(slice.view).toBe('form')
    expect((slice as { errorMessage?: string }).errorMessage).toBeDefined()
  })

  // Why: a blank prompt used to become the placeholder spec "Camada de N cubos" — workers got
  // dispatched with nothing actionable. An agent without a task is never a valid litter.
  it('produces a form-error when an agent is chosen but the prompt is blank', () => {
    const agentNoPrompt: FanOutSlice = {
      ...validForm,
      fields: { count: 3, agent: 'claude', prompt: '   ' }
    }
    const slice = reduceFanOut(agentNoPrompt, { type: 'submit', mutationIds: ['m1'] })
    expect(slice.view).toBe('form')
    expect((slice as { errorMessage?: unknown }).errorMessage).toEqual(
      plainFailure(fanOutPromptRequiredMessage())
    )
  })

  it('runs when an agent is chosen and the prompt has text', () => {
    const agentWithPrompt: FanOutSlice = {
      ...validForm,
      fields: { count: 3, agent: 'claude', prompt: 'fix the bug' }
    }
    const slice = reduceFanOut(agentWithPrompt, { type: 'submit', mutationIds: ['m1'] })
    expect(slice.view).toBe('running')
  })
})

describe('fanOutSubmitBlocker', () => {
  const validForm: FanOutSlice = {
    view: 'form',
    parentId: 'w1',
    fields: { count: 3, agent: 'none', prompt: '' },
    repoSelector: 'id:repo-a'
  }

  it('returns null for a submittable form', () => {
    expect(fanOutSubmitBlocker(validForm)).toBeNull()
  })

  it('returns null outside the form view', () => {
    expect(fanOutSubmitBlocker(emptyFanOutSlice())).toBeNull()
  })

  it('blocks on a missing repo selector', () => {
    expect(fanOutSubmitBlocker({ ...validForm, repoSelector: null })).toEqual(expect.any(String))
  })

  it('blocks on an out-of-range count', () => {
    expect(
      fanOutSubmitBlocker({ ...validForm, fields: { ...validForm.fields, count: 99 } })
    ).toEqual(expect.any(String))
  })

  it('blocks a blank prompt only when an agent is chosen', () => {
    expect(
      fanOutSubmitBlocker({ ...validForm, fields: { count: 3, agent: 'claude', prompt: '' } })
    ).toBe(fanOutPromptRequiredMessage())
    expect(
      fanOutSubmitBlocker({ ...validForm, fields: { count: 3, agent: 'none', prompt: '' } })
    ).toBeNull()
  })
})

describe('fanOutObjectiveText', () => {
  it('is the trimmed prompt — no generated placeholder anymore', () => {
    expect(fanOutObjectiveText({ count: 3, agent: 'claude', prompt: '  fix the bug  ' })).toBe(
      'fix the bug'
    )
    expect(fanOutObjectiveText({ count: 3, agent: 'claude', prompt: '   ' })).toBe('')
  })
})

describe('reduceFanOut — form-error', () => {
  it('applies only to the form view', () => {
    const formSlice: FanOutSlice = {
      view: 'form',
      parentId: 'w1',
      fields: { count: 3, agent: 'none', prompt: '' },
      repoSelector: null
    }
    const slice = reduceFanOut(formSlice, { type: 'form-error', message: plainFailure('boom') })
    expect((slice as { errorMessage?: unknown }).errorMessage).toEqual(plainFailure('boom'))
  })

  it('is a no-op outside the form view', () => {
    const closed = emptyFanOutSlice()
    expect(reduceFanOut(closed, { type: 'form-error', message: plainFailure('boom') })).toBe(closed)
  })
})

describe('reduceFanOut — child-created / child-failed / member-status', () => {
  it('child-created fills in the worktreeId for the matching entry only', () => {
    const slice = runningSliceWithBatch([
      { mutationId: 'm1', worktreeId: null, failed: false, dispatchId: null, taskId: null },
      { mutationId: 'm2', worktreeId: null, failed: false, dispatchId: null, taskId: null }
    ])
    const next = reduceFanOut(slice, { type: 'child-created', mutationId: 'm1', worktreeId: 'w2' })
    expect(next).toMatchObject({
      batch: [
        { mutationId: 'm1', worktreeId: 'w2', failed: false, dispatchId: null, taskId: null },
        { mutationId: 'm2', worktreeId: null, failed: false, dispatchId: null, taskId: null }
      ]
    })
  })

  it('child-failed marks the matching entry failed only', () => {
    const slice = runningSliceWithBatch([
      { mutationId: 'm1', worktreeId: null, failed: false, dispatchId: null, taskId: null },
      { mutationId: 'm2', worktreeId: null, failed: false, dispatchId: null, taskId: null }
    ])
    const next = reduceFanOut(slice, { type: 'child-failed', mutationId: 'm2' })
    expect(next).toMatchObject({
      batch: [
        { mutationId: 'm1', worktreeId: null, failed: false, dispatchId: null, taskId: null },
        { mutationId: 'm2', worktreeId: null, failed: true, dispatchId: null, taskId: null }
      ]
    })
  })

  it('member-status merges into the memberStatus map', () => {
    const slice = runningSliceWithBatch([
      { mutationId: 'm1', worktreeId: 'w2', failed: false, dispatchId: null, taskId: null }
    ])
    const next = reduceFanOut(slice, { type: 'member-status', worktreeId: 'w2', status: 'working' })
    expect(next).toMatchObject({ memberStatus: { w2: 'working' } })
  })

  it('all three are a no-op outside the running view', () => {
    const closed = emptyFanOutSlice()
    expect(
      reduceFanOut(closed, { type: 'child-created', mutationId: 'm1', worktreeId: 'w2' })
    ).toBe(closed)
    expect(reduceFanOut(closed, { type: 'child-failed', mutationId: 'm1' })).toBe(closed)
    expect(
      reduceFanOut(closed, { type: 'member-status', worktreeId: 'w2', status: 'working' })
    ).toBe(closed)
  })
})

describe('reduceFanOut — run-created / child-dispatched (lease run, Change B)', () => {
  it('run-created sets running.runId', () => {
    const slice = runningSliceWithBatch([
      { mutationId: 'm1', worktreeId: null, failed: false, dispatchId: null, taskId: null }
    ])
    const next = reduceFanOut(slice, { type: 'run-created', runId: 'run-1' })
    expect(next).toMatchObject({ runId: 'run-1' })
  })

  it('run-created is a no-op outside the running view', () => {
    const closed = emptyFanOutSlice()
    expect(reduceFanOut(closed, { type: 'run-created', runId: 'run-1' })).toBe(closed)
  })

  it('child-dispatched sets dispatchId/taskId on the matching entry only', () => {
    const slice = runningSliceWithBatch([
      { mutationId: 'm1', worktreeId: null, failed: false, dispatchId: null, taskId: null },
      { mutationId: 'm2', worktreeId: null, failed: false, dispatchId: null, taskId: null }
    ])
    const next = reduceFanOut(slice, {
      type: 'child-dispatched',
      mutationId: 'm1',
      dispatchId: 'dispatch-1',
      taskId: 'task-1'
    })
    expect(next).toMatchObject({
      batch: [
        { mutationId: 'm1', dispatchId: 'dispatch-1', taskId: 'task-1' },
        { mutationId: 'm2', dispatchId: null, taskId: null }
      ]
    })
  })

  it('child-dispatched is a no-op outside the running view', () => {
    const closed = emptyFanOutSlice()
    expect(
      reduceFanOut(closed, {
        type: 'child-dispatched',
        mutationId: 'm1',
        dispatchId: 'dispatch-1',
        taskId: 'task-1'
      })
    ).toBe(closed)
  })
})

const gateRow = (overrides: Partial<LeaseGateRow> = {}): LeaseGateRow => ({
  id: 'gate-1',
  runId: 'run-1',
  taskId: 'task-1',
  question: 'Which approach?',
  options: '[]',
  status: 'pending',
  resolution: null,
  createdAt: '2026-01-01T00:00:00Z',
  resolvedAt: null,
  ...overrides
})

const questionRow = (overrides: Partial<LeaseQuestionRow> = {}): LeaseQuestionRow => ({
  messageId: 'msg-1',
  runId: 'run-1',
  dispatchId: 'dispatch-1',
  askerHandle: 'worker-1',
  status: 'pending',
  answerMessageId: null,
  answerBody: null,
  answeredByGeneration: null,
  createdAt: '2026-01-01T00:00:00Z',
  answeredAt: null,
  closedAt: null,
  ...overrides
})

describe('reduceFanOut — gates-updated / questions-updated (Change C-EXTENDED)', () => {
  it('gates-updated groups gates by taskId under decisionVisibility.gatesByTaskId', () => {
    const slice = runningSliceWithBatch([
      { mutationId: 'm1', worktreeId: 'w2', failed: false, dispatchId: null, taskId: 'task-1' }
    ])
    const gates = [
      gateRow({ id: 'gate-1', taskId: 'task-1' }),
      gateRow({ id: 'gate-2', taskId: 'task-2' })
    ]
    const next = reduceFanOut(slice, { type: 'gates-updated', gates })
    expect(next).toMatchObject({
      decisionVisibility: {
        gatesByTaskId: {
          'task-1': [gates[0]],
          'task-2': [gates[1]]
        }
      }
    })
  })

  it('gates-updated replaces the prior gate snapshot wholesale, not merges it', () => {
    const slice = runningSliceWithBatch([])
    const first = reduceFanOut(slice, {
      type: 'gates-updated',
      gates: [gateRow({ id: 'gate-1', taskId: 'task-1' })]
    })
    const second = reduceFanOut(first, {
      type: 'gates-updated',
      gates: [gateRow({ id: 'gate-2', taskId: 'task-2' })]
    })
    expect(second).toMatchObject({
      decisionVisibility: {
        gatesByTaskId: { 'task-2': [expect.objectContaining({ id: 'gate-2' })] }
      }
    })
    if (second.view === 'running') {
      expect(second.decisionVisibility?.gatesByTaskId['task-1']).toBeUndefined()
    }
  })

  it('questions-updated groups questions by dispatchId under decisionVisibility.questionsByDispatchId', () => {
    const slice = runningSliceWithBatch([
      { mutationId: 'm1', worktreeId: 'w2', failed: false, dispatchId: 'dispatch-1', taskId: null }
    ])
    const questions = [questionRow({ messageId: 'msg-1', dispatchId: 'dispatch-1' })]
    const next = reduceFanOut(slice, { type: 'questions-updated', questions })
    expect(next).toMatchObject({
      decisionVisibility: { questionsByDispatchId: { 'dispatch-1': questions } }
    })
  })

  it('gates-updated/questions-updated preserve the other map untouched', () => {
    const slice = runningSliceWithBatch([])
    const withGates = reduceFanOut(slice, {
      type: 'gates-updated',
      gates: [gateRow({ taskId: 'task-1' })]
    })
    const withBoth = reduceFanOut(withGates, {
      type: 'questions-updated',
      questions: [questionRow({ dispatchId: 'dispatch-1' })]
    })
    expect(withBoth).toMatchObject({
      decisionVisibility: {
        gatesByTaskId: { 'task-1': [expect.objectContaining({ taskId: 'task-1' })] },
        questionsByDispatchId: {
          'dispatch-1': [expect.objectContaining({ dispatchId: 'dispatch-1' })]
        }
      }
    })
  })

  it('gates-updated / questions-updated are a no-op outside the running view', () => {
    const closed = emptyFanOutSlice()
    expect(reduceFanOut(closed, { type: 'gates-updated', gates: [] })).toBe(closed)
    expect(reduceFanOut(closed, { type: 'questions-updated', questions: [] })).toBe(closed)
  })
})

describe('fanOutDecisionCounts', () => {
  it('is all zero outside the running view', () => {
    expect(fanOutDecisionCounts(emptyFanOutSlice())).toEqual({ gateCount: 0, questionCount: 0 })
  })

  it('is all zero for a running slice with no decisionVisibility set', () => {
    expect(fanOutDecisionCounts(runningSliceWithBatch([]))).toEqual({
      gateCount: 0,
      questionCount: 0
    })
  })

  it('sums gates/questions across every task/dispatch bucket', () => {
    const slice = runningSliceWithBatch([])
    const withGates = reduceFanOut(slice, {
      type: 'gates-updated',
      gates: [gateRow({ id: 'g1', taskId: 'task-1' }), gateRow({ id: 'g2', taskId: 'task-2' })]
    })
    const withBoth = reduceFanOut(withGates, {
      type: 'questions-updated',
      questions: [questionRow({ messageId: 'q1', dispatchId: 'dispatch-1' })]
    })
    expect(fanOutDecisionCounts(withBoth)).toEqual({ gateCount: 2, questionCount: 1 })
  })
})

describe('reduceFanOut — submit seeds lease fields to null', () => {
  it('startSubmit seeds running.runId and every batch entry dispatchId/taskId to null', () => {
    const validForm: FanOutSlice = {
      view: 'form',
      parentId: 'w1',
      fields: { count: 2, agent: 'claude', prompt: 'fix the bug' },
      repoSelector: 'id:repo-a'
    }
    const slice = reduceFanOut(validForm, { type: 'submit', mutationIds: ['m1', 'm2'] })
    expect(slice).toMatchObject({
      runId: null,
      batch: [
        { mutationId: 'm1', dispatchId: null, taskId: null },
        { mutationId: 'm2', dispatchId: null, taskId: null }
      ]
    })
  })
})

describe('reduceFanOut — cancel / close', () => {
  it.each(['cancel', 'close'] as const)(
    '%s returns to closed, keeping repoSelector, from form',
    (type) => {
      const formSlice: FanOutSlice = {
        view: 'form',
        parentId: 'w1',
        fields: { count: 3, agent: 'none', prompt: '' },
        repoSelector: 'id:a'
      }
      expect(reduceFanOut(formSlice, { type })).toEqual({ view: 'closed', repoSelector: 'id:a' })
    }
  )

  it.each(['cancel', 'close'] as const)(
    '%s returns to closed, keeping repoSelector, from running',
    (type) => {
      const running: FanOutSlice = {
        view: 'running',
        parentId: 'w1',
        fields: { count: 3, agent: 'none', prompt: '' },
        repoSelector: 'id:b',
        batch: [],
        memberStatus: {},
        runId: null
      }
      expect(reduceFanOut(running, { type })).toEqual({ view: 'closed', repoSelector: 'id:b' })
    }
  )
})

describe('clampFanOutCount', () => {
  it('clamps below MIN_FANOUT and above MAX_FANOUT', () => {
    expect(clampFanOutCount(0)).toBe(MIN_FANOUT)
    expect(clampFanOutCount(1000)).toBe(MAX_FANOUT)
    expect(clampFanOutCount(4)).toBe(4)
  })
})

describe('toFanOutInputs', () => {
  const formSlice: FanOutSlice = {
    view: 'form',
    parentId: 'w1',
    fields: { count: 3, agent: 'none', prompt: '' },
    repoSelector: null
  }

  it('returns nothing for a closed slice', () => {
    expect(toFanOutInputs(emptyFanOutSlice(), 'id:a', ['m1'])).toEqual([])
  })

  it('builds one input per mutationId with a distinct clientMutationId, sharing repo + parentWorktree', () => {
    const inputs = toFanOutInputs(formSlice, 'id:repo-a', ['m1', 'm2'])
    expect(inputs).toEqual([
      {
        repo: 'id:repo-a',
        parentWorktree: 'w1',
        clientMutationId: 'm1',
        name: 'fanout-m1',
        nameWasGenerated: true
      },
      {
        repo: 'id:repo-a',
        parentWorktree: 'w1',
        clientMutationId: 'm2',
        name: 'fanout-m2',
        nameWasGenerated: true
      }
    ])
  })

  it('always generates a name (host rejects an empty one) and includes startupAgent/startupPrompt only when agent is not none', () => {
    const inputs = toFanOutInputs(formSlice, 'id:repo-a', ['m1'])
    expect(inputs[0]).toHaveProperty('name')
    expect(inputs[0]).not.toHaveProperty('startupAgent')
    expect(inputs[0]).not.toHaveProperty('startupPrompt')
  })

  it('generates a non-empty, sanitize-safe, deterministic name per mutationId', () => {
    const mutationIds = ['aaaa-bbbb-cccc', 'dddd-eeee-ffff', '00001111-2222']
    const inputs = toFanOutInputs(formSlice, 'id:repo-a', mutationIds)

    for (const input of inputs) {
      expect(input.name).toBeTruthy()
      expect(input.name).toMatch(/^[a-z0-9-]+$/)
      expect(input.nameWasGenerated).toBe(true)
    }

    const names = inputs.map((input) => input.name)
    expect(new Set(names).size).toBe(names.length)

    // Deterministic for a given mutationId: same input twice -> same name.
    const rerun = toFanOutInputs(formSlice, 'id:repo-a', mutationIds)
    expect(rerun.map((input) => input.name)).toEqual(names)
  })

  it('includes startupAgent + startupPrompt when an agent is chosen and prompt is non-blank', () => {
    const withAgent: FanOutSlice = {
      ...formSlice,
      fields: { count: 2, agent: 'claude', prompt: 'ship it' }
    }
    const inputs = toFanOutInputs(withAgent, 'id:repo-a', ['m1'])
    expect(inputs[0]).toMatchObject({ startupAgent: 'claude', startupPrompt: 'ship it' })
  })

  it('omits startupPrompt when the prompt is blank even with an agent chosen', () => {
    const withAgent: FanOutSlice = {
      ...formSlice,
      fields: { count: 2, agent: 'claude', prompt: '   ' }
    }
    const inputs = toFanOutInputs(withAgent, 'id:repo-a', ['m1'])
    expect(inputs[0]).toMatchObject({ startupAgent: 'claude' })
    expect(inputs[0]).not.toHaveProperty('startupPrompt')
  })
})

describe('mapPsStatusToAgentStatus', () => {
  it.each([
    ['working', 'working'],
    ['permission', 'waiting-input'],
    ['idle', 'idle'],
    ['unknown-status', 'idle']
  ] as const)('maps %s to %s', (psStatus, expected) => {
    expect(mapPsStatusToAgentStatus(psStatus)).toBe(expected)
  })
})

describe('mapDispatchStateToAgentStatus', () => {
  it.each([
    ['ready', 'working'],
    ['starting', 'working'],
    ['start_unknown', 'working'],
    ['succeeded', 'idle'],
    ['stopped', 'idle'],
    ['stopping', 'idle'],
    ['stop_unknown', 'idle'],
    ['abandoned', 'idle'],
    ['unsupervised', 'idle'],
    ['failed', 'idle'],
    ['unknown-state', 'idle']
  ] as const)('maps %s to %s', (workerState, expected) => {
    expect(mapDispatchStateToAgentStatus(workerState)).toBe(expected)
  })
})

describe('isFailedDispatch', () => {
  it('is true when workerState is failed', () => {
    expect(isFailedDispatch({ workerState: 'failed', dispatchStatus: 'dispatched' })).toBe(true)
  })

  it('is true when dispatchStatus is failed', () => {
    expect(isFailedDispatch({ workerState: 'ready', dispatchStatus: 'failed' })).toBe(true)
  })

  it('is true when dispatchStatus is circuit_broken', () => {
    expect(isFailedDispatch({ workerState: 'ready', dispatchStatus: 'circuit_broken' })).toBe(true)
  })

  it('is false otherwise', () => {
    expect(isFailedDispatch({ workerState: 'ready', dispatchStatus: 'dispatched' })).toBe(false)
    expect(isFailedDispatch({ workerState: 'succeeded', dispatchStatus: 'completed' })).toBe(false)
  })
})

describe('fanOutMemberIds', () => {
  it('is empty when closed', () => {
    expect(fanOutMemberIds(emptyFanOutSlice())).toEqual([])
  })

  it('is just the parent while in form (no children created yet)', () => {
    const formSlice: FanOutSlice = {
      view: 'form',
      parentId: 'w1',
      fields: { count: 3, agent: 'none', prompt: '' },
      repoSelector: null
    }
    expect(fanOutMemberIds(formSlice)).toEqual(['w1'])
  })

  it('is the parent plus every created worktreeId, excluding pending/failed entries', () => {
    const running: FanOutSlice = {
      view: 'running',
      parentId: 'w1',
      fields: { count: 3, agent: 'none', prompt: '' },
      repoSelector: null,
      batch: [
        { mutationId: 'm1', worktreeId: 'w2', failed: false, dispatchId: null, taskId: null },
        { mutationId: 'm2', worktreeId: null, failed: false, dispatchId: null, taskId: null },
        { mutationId: 'm3', worktreeId: null, failed: true, dispatchId: null, taskId: null },
        { mutationId: 'm4', worktreeId: 'w4', failed: false, dispatchId: null, taskId: null }
      ],
      memberStatus: {},
      runId: null
    }
    expect(fanOutMemberIds(running)).toEqual(['w1', 'w2', 'w4'])
  })
})

describe('fanOutParentId', () => {
  it('is null when closed', () => {
    expect(fanOutParentId(emptyFanOutSlice())).toBeNull()
  })

  it('returns the parentId on form', () => {
    const formSlice: FanOutSlice = {
      view: 'form',
      parentId: 'w1',
      fields: { count: 3, agent: 'none', prompt: '' },
      repoSelector: null
    }
    expect(fanOutParentId(formSlice)).toBe('w1')
  })

  it('returns the parentId on running', () => {
    const running: FanOutSlice = {
      view: 'running',
      parentId: 'w1',
      fields: { count: 3, agent: 'none', prompt: '' },
      repoSelector: null,
      batch: [],
      memberStatus: {},
      runId: null
    }
    expect(fanOutParentId(running)).toBe('w1')
  })
})

describe('fanOutCounts', () => {
  it('is all zero outside the running view', () => {
    expect(fanOutCounts(emptyFanOutSlice())).toEqual({
      total: 0,
      naciendo: 0,
      working: 0,
      waitingInput: 0,
      created: 0,
      failed: 0
    })
  })

  it('matches the mockup fixture: 2 trabajando · 1 esperando · 1 naciendo · 1 listo', () => {
    const running: FanOutSlice = {
      view: 'running',
      parentId: 'w1',
      fields: { count: 5, agent: 'claude', prompt: '' },
      repoSelector: 'id:a',
      batch: [
        { mutationId: 'm1', worktreeId: 'w2', failed: false, dispatchId: null, taskId: null },
        { mutationId: 'm2', worktreeId: 'w3', failed: false, dispatchId: null, taskId: null },
        { mutationId: 'm3', worktreeId: 'w4', failed: false, dispatchId: null, taskId: null },
        { mutationId: 'm4', worktreeId: 'w5', failed: false, dispatchId: null, taskId: null },
        { mutationId: 'm5', worktreeId: null, failed: false, dispatchId: null, taskId: null }
      ],
      memberStatus: { w2: 'working', w3: 'working', w4: 'waiting-input', w5: 'idle' },
      runId: null
    }
    expect(fanOutCounts(running)).toEqual({
      total: 5,
      naciendo: 1,
      working: 2,
      waitingInput: 1,
      created: 1,
      failed: 0
    })
  })

  it('counts a failed entry separately from naciendo and created', () => {
    const running: FanOutSlice = {
      view: 'running',
      parentId: 'w1',
      fields: { count: 2, agent: 'none', prompt: '' },
      repoSelector: null,
      batch: [
        { mutationId: 'm1', worktreeId: null, failed: true, dispatchId: null, taskId: null },
        { mutationId: 'm2', worktreeId: null, failed: false, dispatchId: null, taskId: null }
      ],
      memberStatus: {},
      runId: null
    }
    expect(fanOutCounts(running)).toEqual({
      total: 2,
      naciendo: 1,
      working: 0,
      waitingInput: 0,
      created: 0,
      failed: 1
    })
  })

  it('treats a created member with no memberStatus entry as idle (created)', () => {
    const running: FanOutSlice = {
      view: 'running',
      parentId: 'w1',
      fields: { count: 1, agent: 'none', prompt: '' },
      repoSelector: null,
      batch: [
        { mutationId: 'm1', worktreeId: 'w2', failed: false, dispatchId: null, taskId: null }
      ],
      memberStatus: {},
      runId: null
    }
    expect(fanOutCounts(running).created).toBe(1)
  })
})

describe('composeFanOutGraph', () => {
  const parent = node({ id: 'w1', childIds: [] })

  it('returns the graph unchanged outside the running view', () => {
    const graph = graphOf([parent])
    expect(composeFanOutGraph(graph, emptyFanOutSlice())).toBe(graph)
  })

  it('injects a spawning placeholder per pending entry, linked into the parent childIds', () => {
    const graph = graphOf([parent])
    const running: FanOutSlice = {
      view: 'running',
      parentId: 'w1',
      fields: { count: 2, agent: 'claude', prompt: '' },
      repoSelector: 'id:a',
      batch: [
        { mutationId: 'm1', worktreeId: null, failed: false, dispatchId: null, taskId: null },
        { mutationId: 'm2', worktreeId: null, failed: false, dispatchId: null, taskId: null }
      ],
      memberStatus: {},
      runId: null
    }
    const composed = composeFanOutGraph(graph, running)

    const placeholderIds = [`${FANOUT_PLACEHOLDER_PREFIX}m1`, `${FANOUT_PLACEHOLDER_PREFIX}m2`]
    for (const id of placeholderIds) {
      const placeholder = composed.nodes.get(id)
      expect(placeholder).toBeDefined()
      expect(placeholder?.activity.spawn).not.toBeNull()
      expect(placeholder?.parentId).toBe('w1')
    }
    expect(childrenOf(composed, 'w1')).toEqual(expect.arrayContaining(placeholderIds))
  })

  it('skips a failed entry — no placeholder is injected for it', () => {
    const graph = graphOf([parent])
    const running: FanOutSlice = {
      view: 'running',
      parentId: 'w1',
      fields: { count: 1, agent: 'none', prompt: '' },
      repoSelector: null,
      batch: [{ mutationId: 'm1', worktreeId: null, failed: true, dispatchId: null, taskId: null }],
      memberStatus: {},
      runId: null
    }
    const composed = composeFanOutGraph(graph, running)
    expect(composed.nodes.has(`${FANOUT_PLACEHOLDER_PREFIX}m1`)).toBe(false)
  })

  it('skips an already-real entry — no placeholder, and overlays its memberStatus', () => {
    const child = node({ id: 'w2', parentId: 'w1', kind: 'worktree', isMain: false })
    const graph = graphOf([parent, child])
    const running: FanOutSlice = {
      view: 'running',
      parentId: 'w1',
      fields: { count: 1, agent: 'none', prompt: '' },
      repoSelector: null,
      batch: [
        { mutationId: 'm1', worktreeId: 'w2', failed: false, dispatchId: null, taskId: null }
      ],
      memberStatus: { w2: 'working' },
      runId: null
    }
    const composed = composeFanOutGraph(graph, running)
    expect(composed.nodes.has(`${FANOUT_PLACEHOLDER_PREFIX}m1`)).toBe(false)
    expect(composed.nodes.get('w2')?.activity.agentStatus).toBe('working')
  })

  it('is idempotent — composing twice produces the same result', () => {
    const graph = graphOf([parent])
    const running: FanOutSlice = {
      view: 'running',
      parentId: 'w1',
      fields: { count: 1, agent: 'none', prompt: '' },
      repoSelector: null,
      batch: [
        { mutationId: 'm1', worktreeId: null, failed: false, dispatchId: null, taskId: null }
      ],
      memberStatus: {},
      runId: null
    }
    const once = composeFanOutGraph(graph, running)
    const twice = composeFanOutGraph(once, running)
    expect([...twice.nodes.keys()].sort()).toEqual([...once.nodes.keys()].sort())
    expect(twice.nodes.get('w1')?.childIds).toEqual(once.nodes.get('w1')?.childIds)
  })
})

describe('fanOutSettled', () => {
  const running = (
    agent: 'none' | 'claude',
    batch: FanOutBatchEntry[],
    memberStatus: Record<string, 'idle' | 'working' | 'waiting-input'> = {}
  ): FanOutSlice => ({
    view: 'running',
    parentId: 'w1',
    fields: { count: batch.length, agent, prompt: '' },
    repoSelector: 'id:r',
    batch,
    memberStatus,
    runId: null
  })
  const entry = (id: string, worktreeId: string | null, failed = false): FanOutBatchEntry => ({
    mutationId: id,
    worktreeId,
    failed,
    dispatchId: null,
    taskId: null
  })

  it('is false for anything that is not running', () => {
    expect(fanOutSettled(emptyFanOutSlice())).toBe(false)
  })

  it('an agent none litter settles as soon as every child is created or failed', () => {
    expect(fanOutSettled(running('none', [entry('a', 'c1'), entry('b', null)]))).toBe(false)
    expect(fanOutSettled(running('none', [entry('a', 'c1'), entry('b', null, true)]))).toBe(true)
  })

  it('an agent litter waits for a first status per child and for the work to finish', () => {
    const batch = [entry('a', 'c1'), entry('b', 'c2')]
    expect(fanOutSettled(running('claude', batch))).toBe(false)
    expect(fanOutSettled(running('claude', batch, { c1: 'idle', c2: 'working' }))).toBe(false)
    expect(fanOutSettled(running('claude', batch, { c1: 'idle', c2: 'waiting-input' }))).toBe(false)
    expect(fanOutSettled(running('claude', batch, { c1: 'idle', c2: 'idle' }))).toBe(true)
  })

  it('stays unsettled while a gate or question is pending', () => {
    const slice = running('none', [entry('a', 'c1')])
    if (slice.view !== 'running') throw new Error('expected running')
    const withGate = reduceFanOut(slice, {
      type: 'gates-updated',
      gates: [gateRow({ id: 'gate-1', taskId: 'task-1' })]
    })
    expect(fanOutDecisionCounts(withGate).gateCount).toBeGreaterThan(0)
    expect(fanOutSettled(withGate)).toBe(false)
  })
})
