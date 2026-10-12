import { describe, expect, it } from 'vitest'
import { LITTER_STORAGE_KEY, readRememberedLitter, rememberLitter } from './litter-memory'
import type { LitterStorage } from './litter-memory'

const memoryStorage = (initial: Record<string, string> = {}): LitterStorage => {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key)
  }
}

const throwingStorage: LitterStorage = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
  removeItem: () => {
    throw new Error('blocked')
  }
}

describe('litter memory', () => {
  it('round-trips the member ids', () => {
    const storage = memoryStorage()
    rememberLitter(storage, ['a', 'b'])
    expect(readRememberedLitter(storage)).toEqual(['a', 'b'])
  })

  it('clears the entry when the litter is empty', () => {
    const storage = memoryStorage({ [LITTER_STORAGE_KEY]: '["a"]' })
    rememberLitter(storage, [])
    expect(readRememberedLitter(storage)).toEqual([])
  })

  it.each(['not json', '{"a":1}', '[1,2]'])('ignores corrupt data %s', (raw) => {
    expect(readRememberedLitter(memoryStorage({ [LITTER_STORAGE_KEY]: raw }))).toEqual([])
  })

  it('survives missing or throwing storage', () => {
    expect(readRememberedLitter(null)).toEqual([])
    expect(readRememberedLitter(throwingStorage)).toEqual([])
    expect(() => rememberLitter(throwingStorage, ['a'])).not.toThrow()
    expect(() => rememberLitter(null, ['a'])).not.toThrow()
  })
})
