import { describe, expect, it } from 'vitest'
import { compareLitterMembers } from './compare-litter'
import { createSceneStore } from './scene-store'
import type { WorktreeGraph } from '../domain/worktree-graph/types'

const graphWith = (ids: readonly string[]): WorktreeGraph =>
  ({ nodes: new Map(ids.map((id) => [id, {}])) }) as unknown as WorktreeGraph

describe('compareLitterMembers', () => {
  it('uses the running fan-out children, parent dropped', () => {
    const store = createSceneStore()
    store.dispatchFanOut({ type: 'open-for-node', nodeId: 'root' })
    store.dispatchFanOut({ type: 'set-repo-selector', repoSelector: 'id:r' })
    store.dispatchFanOut({ type: 'submit', mutationIds: ['m0'] })
    store.dispatchFanOut({ type: 'child-created', mutationId: 'm0', worktreeId: 'c0' })
    store.update({ rememberedLitter: ['old'] })
    expect(compareLitterMembers(store.get())).toEqual(['c0'])
  })

  it('falls back to the remembered litter after a reload, dropping members gone from the graph', () => {
    const store = createSceneStore()
    store.update({ graph: graphWith(['a']), rememberedLitter: ['a', 'gone'] })
    expect(compareLitterMembers(store.get())).toEqual(['a'])
  })

  it('is empty with nothing running and nothing remembered', () => {
    expect(compareLitterMembers(createSceneStore().get())).toEqual([])
  })
})
