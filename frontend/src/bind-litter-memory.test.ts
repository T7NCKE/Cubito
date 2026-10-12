import { describe, expect, it } from 'vitest'
import { bindLitterMemory } from './bind-litter-memory'
import { LITTER_STORAGE_KEY } from './application/litter-memory'
import type { LitterStorage } from './application/litter-memory'
import { createSceneStore } from './application/scene-store'

const memoryStorage = (
  initial: Record<string, string> = {}
): LitterStorage & {
  data: Map<string, string>
} => {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key)
  }
}

describe('bindLitterMemory', () => {
  it('restores the remembered litter into the store at startup', () => {
    const store = createSceneStore()
    bindLitterMemory(store, memoryStorage({ [LITTER_STORAGE_KEY]: '["a","b"]' }))
    expect(store.get().rememberedLitter).toEqual(['a', 'b'])
  })

  it('persists the running fan-out children and survives the slice closing', () => {
    const store = createSceneStore()
    const storage = memoryStorage()
    bindLitterMemory(store, storage)
    store.dispatchFanOut({ type: 'open-for-node', nodeId: 'root' })
    store.dispatchFanOut({ type: 'set-repo-selector', repoSelector: 'id:r' })
    store.dispatchFanOut({ type: 'submit', mutationIds: ['m0'] })
    store.dispatchFanOut({ type: 'child-created', mutationId: 'm0', worktreeId: 'c0' })
    expect(JSON.parse(storage.data.get(LITTER_STORAGE_KEY)!)).toEqual(['c0'])
    store.dispatchFanOut({ type: 'close' })
    expect(store.get().rememberedLitter).toEqual(['c0'])
  })
})
