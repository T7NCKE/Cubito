import { describe, expect, it } from 'vitest'
import { compareLitterMembers } from './compare-litter'
import { createSceneStore } from './scene-store'
import type { WorktreeGraph } from '../domain/worktree-graph/types'

const graphWith = (ids: readonly string[]): WorktreeGraph =>
  ({ nodes: new Map(ids.map((id) => [id, {}])) }) as unknown as WorktreeGraph

type NodeSpec = { branch: string; childIds?: readonly string[]; parentId?: string }
const graphOfNodes = (specs: Record<string, NodeSpec>): WorktreeGraph =>
  ({
    nodes: new Map(
      Object.entries(specs).map(([id, spec]) => [id, { id, childIds: [], parentId: null, ...spec }])
    )
  }) as unknown as WorktreeGraph

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

  describe('derived from the graph (new tab or device)', () => {
    const graph = graphOfNodes({
      root: { branch: 'refs/heads/main', childIds: ['x', 'f1', 'f2'] },
      x: { branch: 'refs/heads/feature-x', parentId: 'root' },
      f1: { branch: 'refs/heads/user/fanout-0123456789', parentId: 'root' },
      f2: { branch: 'refs/heads/fanout-abcdef0123', parentId: 'root' }
    })

    it("uses the selected node's fan-out children, ignoring unrelated children", () => {
      const store = createSceneStore()
      store.update({ graph, selection: { selectedId: 'root' } })
      expect(compareLitterMembers(store.get())).toEqual(['f1', 'f2'])
    })

    it('falls back to all children when none looks like fan-out litter', () => {
      const store = createSceneStore()
      store.update({
        graph: graphOfNodes({
          root: { branch: 'refs/heads/main', childIds: ['a', 'b'] },
          a: { branch: 'refs/heads/a', parentId: 'root' },
          b: { branch: 'refs/heads/b', parentId: 'root' }
        }),
        selection: { selectedId: 'root' }
      })
      expect(compareLitterMembers(store.get())).toEqual(['a', 'b'])
    })

    it('selecting a fan-out child compares its siblings', () => {
      const store = createSceneStore()
      store.update({ graph, selection: { selectedId: 'f1' } })
      expect(compareLitterMembers(store.get())).toEqual(['f1', 'f2'])
    })

    it('prefers a remembered litter over the derivation', () => {
      const store = createSceneStore()
      store.update({ graph, selection: { selectedId: 'root' }, rememberedLitter: ['x'] })
      expect(compareLitterMembers(store.get())).toEqual(['x'])
    })

    it('is empty with no selection or a childless selection', () => {
      const store = createSceneStore()
      store.update({ graph })
      expect(compareLitterMembers(store.get())).toEqual([])
      store.update({ selection: { selectedId: 'x' } })
      expect(compareLitterMembers(store.get())).toEqual([])
    })
  })
})
