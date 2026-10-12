import { plainFailure } from '../../application/i18n/user-facing-error'
import { describe, expect, it } from 'vitest'
import { fanOutPanelVisible, fanOutViewModel } from './fan-out-view-model'
import { emptyWorktreeGraph } from '../../domain/worktree-graph/types'
import type { WorktreeGraph, WorktreeNode } from '../../domain/worktree-graph/types'
import { inertActivity } from '../../domain/worktree-graph/node-activity'
import { MIN_FANOUT, MAX_FANOUT } from '../../application/fan-out-model'
import type { FanOutSlice } from '../../application/fan-out-model'

describe('fanOutViewModel — closed', () => {
  it('renders nothing when the slice is closed', () => {
    expect(fanOutViewModel({ view: 'closed', repoSelector: null })).toBeNull()
  })
})

const formSlice = (
  overrides: Partial<Extract<FanOutSlice, { view: 'form' }>> = {}
): FanOutSlice => ({
  view: 'form',
  parentId: 'w1',
  fields: { count: 3, agent: 'none', prompt: '' },
  repoSelector: null,
  ...overrides
})

describe('fanOutViewModel — form', () => {
  it('projects the count stepper with min/max from the domain constants', () => {
    const model = fanOutViewModel(formSlice({ fields: { count: 4, agent: 'none', prompt: '' } }))
    if (model?.view !== 'form') throw new Error('expected form')
    expect(model.count).toEqual({ value: 4, min: MIN_FANOUT, max: MAX_FANOUT, enabled: true })
  })

  it('projects agent and prompt field values verbatim', () => {
    const model = fanOutViewModel(
      formSlice({ fields: { count: 3, agent: 'claude', prompt: 'hola' } })
    )
    if (model?.view !== 'form') throw new Error('expected form')
    expect(model.agent.value).toBe('claude')
    expect(model.prompt.value).toBe('hola')
  })

  it('PROMPT is disabled when agent is none, enabled once an agent is chosen', () => {
    const none = fanOutViewModel(formSlice())
    const claude = fanOutViewModel(formSlice({ fields: { count: 3, agent: 'claude', prompt: '' } }))
    if (none?.view !== 'form' || claude?.view !== 'form') throw new Error('expected form')
    expect(none.prompt.enabled).toBe(false)
    expect(claude.prompt.enabled).toBe(true)
  })

  it('submit is disabled while the repo selector is unresolved', () => {
    const model = fanOutViewModel(formSlice({ repoSelector: null }))
    if (model?.view !== 'form') throw new Error('expected form')
    expect(model.submitEnabled).toBe(false)
  })

  it('submit is enabled once the repo is resolved and the count is within bounds', () => {
    const model = fanOutViewModel(formSlice({ repoSelector: 'id:repo-1' }))
    if (model?.view !== 'form') throw new Error('expected form')
    expect(model.submitEnabled).toBe(true)
  })

  it('submit is disabled when the count is out of bounds, even with a resolved repo', () => {
    const tooLow = fanOutViewModel(
      formSlice({
        repoSelector: 'id:repo-1',
        fields: { count: MIN_FANOUT - 1, agent: 'none', prompt: '' }
      })
    )
    const tooHigh = fanOutViewModel(
      formSlice({
        repoSelector: 'id:repo-1',
        fields: { count: MAX_FANOUT + 1, agent: 'none', prompt: '' }
      })
    )
    if (tooLow?.view !== 'form' || tooHigh?.view !== 'form') throw new Error('expected form')
    expect(tooLow.submitEnabled).toBe(false)
    expect(tooHigh.submitEnabled).toBe(false)
  })

  it('carries no error message when the slice has none', () => {
    const model = fanOutViewModel(formSlice())
    if (model?.view !== 'form') throw new Error('expected form')
    expect(model.errorMessage).toBeNull()
  })

  it('passes the slice errorMessage through verbatim', () => {
    const model = fanOutViewModel(
      formSlice({ errorMessage: plainFailure('a repo must be selected') })
    )
    if (model?.view !== 'form') throw new Error('expected form')
    expect(model.errorMessage).toEqual(plainFailure('a repo must be selected'))
  })
})

const runningSlice = (
  overrides: Partial<Extract<FanOutSlice, { view: 'running' }>> = {}
): FanOutSlice => ({
  view: 'running',
  parentId: 'w1',
  fields: { count: 5, agent: 'claude', prompt: '' },
  repoSelector: 'id:repo-1',
  batch: [
    { mutationId: 'm1', worktreeId: 'w2', failed: false, dispatchId: null, taskId: null },
    { mutationId: 'm2', worktreeId: 'w3', failed: false, dispatchId: null, taskId: null },
    { mutationId: 'm3', worktreeId: 'w4', failed: false, dispatchId: null, taskId: null },
    { mutationId: 'm4', worktreeId: 'w5', failed: false, dispatchId: null, taskId: null },
    { mutationId: 'm5', worktreeId: null, failed: false, dispatchId: null, taskId: null }
  ],
  memberStatus: { w2: 'working', w3: 'working', w4: 'waiting-input', w5: 'idle' },
  runId: null,
  ...overrides
})

describe('fanOutViewModel — running', () => {
  it('renders the callout as "fan-out · N × agent"', () => {
    const model = fanOutViewModel(runningSlice())
    if (model?.view !== 'running') throw new Error('expected running')
    expect(model.callout).toBe('fan-out · 5 × claude')
  })

  it('matches the mockup fixture counters: 2 trabajando · 1 esperando · 1 naciendo · 1 listo · 0 compuertas · 0 preguntas', () => {
    const model = fanOutViewModel(runningSlice())
    if (model?.view !== 'running') throw new Error('expected running')
    expect(model.counters).toBe(
      '2 trabajando · 1 esperando · 1 naciendo · 1 listo · 0 compuertas · 0 preguntas'
    )
  })

  it('appends the failed count only when at least one entry failed', () => {
    const noFailures = fanOutViewModel(runningSlice())
    const withFailure = fanOutViewModel(
      runningSlice({
        batch: [
          { mutationId: 'm1', worktreeId: null, failed: true, dispatchId: null, taskId: null },
          { mutationId: 'm2', worktreeId: null, failed: false, dispatchId: null, taskId: null }
        ],
        memberStatus: {}
      })
    )
    if (noFailures?.view !== 'running' || withFailure?.view !== 'running') {
      throw new Error('expected running')
    }
    expect(noFailures.counters).not.toContain('error')
    expect(withFailure.counters).toBe(
      '0 trabajando · 0 esperando · 1 naciendo · 0 listos · 0 compuertas · 0 preguntas · 1 error'
    )
  })
})

describe('fanOutViewModel — running — decision visibility (Change C-EXTENDED)', () => {
  it('appends run-level gate/question counts from decisionVisibility to the counters line', () => {
    const model = fanOutViewModel(
      runningSlice({
        decisionVisibility: {
          gatesByTaskId: { 'task-1': [{} as never], 'task-2': [{} as never] },
          questionsByDispatchId: { 'dispatch-1': [{} as never] }
        }
      })
    )
    if (model?.view !== 'running') throw new Error('expected running')
    expect(model.counters).toBe(
      '2 trabajando · 1 esperando · 1 naciendo · 1 listo · 2 compuertas · 1 pregunta'
    )
  })

  it('defaults to 0 compuertas · 0 preguntas when decisionVisibility is absent', () => {
    const model = fanOutViewModel(runningSlice())
    if (model?.view !== 'running') throw new Error('expected running')
    expect(model.counters).toContain('0 compuertas · 0 preguntas')
  })
})

describe('fanOutViewModel — running — per-child failures', () => {
  it('projects one failure row per failed entry, with a label and message', () => {
    const model = fanOutViewModel(
      runningSlice({
        batch: [
          {
            mutationId: 'm1',
            worktreeId: null,
            failed: true,
            dispatchId: null,
            taskId: null,
            errorMessage: plainFailure('network unreachable')
          },
          { mutationId: 'm2', worktreeId: 'w3', failed: false, dispatchId: null, taskId: null }
        ],
        memberStatus: {}
      })
    )
    if (model?.view !== 'running') throw new Error('expected running')
    expect(model.failures).toEqual([
      { mutationId: 'm1', label: 'fanout-m1', message: plainFailure('network unreachable') }
    ])
  })

  it('defaults failures to an empty array when no entry failed', () => {
    const model = fanOutViewModel(runningSlice())
    if (model?.view !== 'running') throw new Error('expected running')
    expect(model.failures).toEqual([])
  })
})

describe('fanOutViewModel — running — gate/question rows (Change F)', () => {
  it('projects pending gates and questions from decisionVisibility onto the running model', () => {
    const model = fanOutViewModel(
      runningSlice({
        decisionVisibility: {
          gatesByTaskId: {
            'task-1': [
              {
                id: 'gate-1',
                runId: 'run-1',
                taskId: 'task-1',
                question: 'Which approach?',
                options: '["a","b"]',
                status: 'pending',
                resolution: null,
                createdAt: '2026-01-01T00:00:00Z',
                resolvedAt: null
              }
            ]
          },
          questionsByDispatchId: {
            'dispatch-1': [
              {
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
                closedAt: null
              }
            ]
          }
        }
      })
    )
    if (model?.view !== 'running') throw new Error('expected running')
    expect(model.gates).toEqual([
      { gateId: 'gate-1', taskId: 'task-1', question: 'Which approach?', options: ['a', 'b'] }
    ])
    expect(model.questions).toEqual([
      { messageId: 'msg-1', dispatchId: 'dispatch-1', askerHandle: 'worker-1' }
    ])
  })

  it('defaults gates/questions to empty arrays when decisionVisibility is absent', () => {
    const model = fanOutViewModel(runningSlice())
    if (model?.view !== 'running') throw new Error('expected running')
    expect(model.gates).toEqual([])
    expect(model.questions).toEqual([])
  })
})

describe('fanOutViewModel — setup hint', () => {
  it('surfaces the setup hint on the form model, null by default', () => {
    expect(fanOutViewModel(formSlice())).toMatchObject({ setupHint: null })
    expect(fanOutViewModel(formSlice(), 'sin setup')).toMatchObject({ setupHint: 'sin setup' })
  })
})

const graphWith = (id: string, branch: string): WorktreeGraph => {
  const node: WorktreeNode = {
    id,
    repoId: 'repo',
    branch,
    path: `/tmp/${id}`,
    status: 'clean',
    isMain: false,
    kind: 'worktree',
    parentId: null,
    childIds: [],
    activity: inertActivity()
  }
  return { ...emptyWorktreeGraph(), nodes: new Map([[id, node]]) }
}

describe('fanOutViewModel — form title', () => {
  it('names the parent branch, short form, like the spawn form does', () => {
    const model = fanOutViewModel(formSlice(), null, graphWith('w1', 'refs/heads/feat/login'))
    if (model?.view !== 'form') throw new Error('expected form')
    expect(model.title).toBe('fan-out · desde feat/login')
  })

  it('falls back to a plain title when the parent is not in the graph', () => {
    const model = fanOutViewModel(formSlice(), null, emptyWorktreeGraph())
    if (model?.view !== 'form') throw new Error('expected form')
    expect(model.title).toBe('fan-out')
  })

  it('falls back to a plain title when no graph is supplied', () => {
    const model = fanOutViewModel(formSlice())
    if (model?.view !== 'form') throw new Error('expected form')
    expect(model.title).toBe('fan-out')
  })
})

describe('fanOutPanelVisible', () => {
  const settled: FanOutSlice = {
    view: 'running',
    parentId: 'w1',
    fields: { count: 1, agent: 'none', prompt: '' },
    repoSelector: 'id:repo-a',
    batch: [{ mutationId: 'm', worktreeId: 'c1', failed: false, dispatchId: null, taskId: null }],
    memberStatus: {},
    runId: null
  }
  const busy: FanOutSlice = {
    ...settled,
    fields: { count: 1, agent: 'claude', prompt: 'x' },
    memberStatus: { c1: 'working' }
  }
  const failed: FanOutSlice = {
    ...settled,
    batch: [{ mutationId: 'm', worktreeId: null, failed: true, dispatchId: null, taskId: null }]
  }
  const parent: WorktreeNode = {
    id: 'w1',
    repoId: 'repo-a',
    branch: 'refs/heads/main',
    path: '/p',
    status: 'in-progress',
    isMain: true,
    kind: 'root',
    parentId: null,
    childIds: [],
    activity: inertActivity()
  }
  const graph: WorktreeGraph = {
    nodes: new Map([['w1', parent]]),
    edges: [],
    rootIds: ['w1']
  }

  it('hides a settled litter on its own', () => {
    expect(fanOutPanelVisible(settled, graph, 'repo-a', false)).toBe(false)
  })

  it('keeps a litter with live work or failures on screen', () => {
    expect(fanOutPanelVisible(busy, graph, 'repo-a', false)).toBe(true)
    expect(fanOutPanelVisible(failed, graph, 'repo-a', false)).toBe(true)
  })

  it('is scoped to the repo of its parent', () => {
    expect(fanOutPanelVisible(busy, graph, 'repo-b', false)).toBe(false)
    expect(fanOutPanelVisible(busy, graph, null, false)).toBe(true)
  })

  it('honours a manual dismissal, and always shows the form', () => {
    expect(fanOutPanelVisible(busy, graph, 'repo-a', true)).toBe(false)
    expect(fanOutPanelVisible(formSlice(), graph, 'repo-b', true)).toBe(true)
    expect(fanOutPanelVisible({ view: 'closed', repoSelector: null }, graph, null, false)).toBe(
      false
    )
  })
})
