import { describe, expect, it, vi } from 'vitest'
import { createFanOutController } from './fan-out-controller'
import type { FanOutControllerDeps } from './fan-out-controller'
import { createSceneStore } from '../../application/scene-store'
import { emptyWorktreeGraph } from '../../domain/worktree-graph/types'
import type { WorktreeGraph, WorktreeNode } from '../../domain/worktree-graph/types'
import { inertActivity } from '../../domain/worktree-graph/node-activity'
import type { FanOutFormHandle } from './fan-out-element'
import type { FanOutFormViewModel } from './fan-out-view-model'

/** Sibling of fan-out-controller.test.ts (already ~730 raw lines) — the real-store re-entrant
 *  sync regression (design finding 3) gets its own file. */

const nodeIn = (id: string, repoId: string): WorktreeNode => ({
  id,
  repoId,
  branch: 'refs/heads/master',
  path: `/${id}`,
  status: 'clean',
  isMain: true,
  kind: 'root',
  parentId: null,
  childIds: [],
  activity: inertActivity()
})

const graphOf = (...nodes: WorktreeNode[]): WorktreeGraph => ({
  ...emptyWorktreeGraph(),
  nodes: new Map(nodes.map((n) => [n.id, n])),
  rootIds: nodes.map((n) => n.id)
})

type FakeForm = FanOutFormHandle & { applyModels: unknown[] }

const createFakeForm = (): FakeForm => {
  const applyModels: unknown[] = []
  return {
    element: {} as HTMLElement,
    applyModels,
    apply: (model) => applyModels.push(model),
    onCountChange: () => () => {},
    onAgentChange: () => () => {},
    onPromptChange: () => () => {},
    onSubmit: () => () => {},
    onCancel: () => () => {},
    onDismiss: () => () => {},
    setVisible: () => {},
    onResolveGate: () => () => {},
    onAnswerQuestion: () => () => {},
    focusFirstField: vi.fn(),
    dispose: vi.fn()
  }
}

function setup(form: FakeForm) {
  const store = createSceneStore()
  const controller = createFanOutController({
    gateway: {
      repoSetupCommand: async () => 'pnpm install'
    } as unknown as FanOutControllerDeps['gateway'],
    createElement: () => form,
    hud: { appendChild: () => {} },
    dispatch: (action) => store.dispatchFanOut(action),
    focusLitter: vi.fn(),
    memberPoll: { start: vi.fn(), stop: vi.fn(), rebindGateway: vi.fn() },
    refetch: async () => {}
  })
  store.subscribe((s) => controller.sync(s.fanOut, s.graph))
  return { store, controller }
}

describe('fan-out re-entrant sync (real store, design finding 3)', () => {
  it('open-for-node leaves the last apply with submit enabled (a repo-anchored open)', () => {
    const form = createFakeForm()
    const { store } = setup(form)
    store.update({ graph: graphOf(nodeIn('w1', 'repo-1')) })

    store.dispatchFanOut({ type: 'open-for-node', nodeId: 'w1' })

    const last = form.applyModels.at(-1) as FanOutFormViewModel
    expect(last.view).toBe('form')
    expect(last.submitEnabled).toBe(true)
    expect(form.focusFirstField).toHaveBeenCalledTimes(1)
  })

  it('reopening on the same repo carries the resolved selector: a single apply, already enabled', () => {
    const form = createFakeForm()
    const { store } = setup(form)
    store.update({ graph: graphOf(nodeIn('w1', 'repo-1')) })
    store.dispatchFanOut({ type: 'open-for-node', nodeId: 'w1' })
    store.dispatchFanOut({ type: 'cancel' })
    form.applyModels.length = 0

    store.dispatchFanOut({ type: 'open-for-node', nodeId: 'w1' })

    expect(form.applyModels).toHaveLength(1)
    expect((form.applyModels[0] as FanOutFormViewModel).submitEnabled).toBe(true)
  })

  it('opening on a node of another repo after close still lands enabled on the first apply', () => {
    const form = createFakeForm()
    const { store } = setup(form)
    store.update({ graph: graphOf(nodeIn('w1', 'repo-1'), nodeIn('w2', 'repo-2')) })
    store.dispatchFanOut({ type: 'open-for-node', nodeId: 'w1' })
    store.dispatchFanOut({ type: 'cancel' })

    store.dispatchFanOut({ type: 'open-for-node', nodeId: 'w2' })

    const last = form.applyModels.at(-1) as FanOutFormViewModel
    expect(last.submitEnabled).toBe(true)
  })
})
