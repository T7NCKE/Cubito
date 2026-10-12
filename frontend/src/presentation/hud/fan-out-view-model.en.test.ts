import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fanOutViewModel } from './fan-out-view-model'
import { fanOutSubmitBlocker, MAX_FANOUT, MIN_FANOUT } from '../../application/fan-out-model'
import type { FanOutSlice } from '../../application/fan-out-model'
import { summarizeChildFailure } from '../../application/fan-out-batch-failures'
import { setActiveLanguage } from '../../application/i18n/translate'

const formSlice = (
  overrides: Partial<Extract<FanOutSlice, { view: 'form' }>> = {}
): Extract<FanOutSlice, { view: 'form' }> => ({
  view: 'form',
  parentId: 'w1',
  fields: { count: 3, agent: 'none', prompt: '' },
  repoSelector: null,
  ...overrides
})

describe('fan-out copy (en)', () => {
  beforeEach(() => setActiveLanguage('en'))
  afterEach(() => setActiveLanguage('es'))

  it('titles the form without a graph', () => {
    const model = fanOutViewModel(formSlice())
    if (model?.view !== 'form') throw new Error('expected form')
    expect(model.title).toBe('fan-out')
  })

  it('words the submit blockers in English', () => {
    expect(fanOutSubmitBlocker(formSlice({ repoSelector: null }))).toBe(
      'repository not resolved yet'
    )
    expect(
      fanOutSubmitBlocker(
        formSlice({ repoSelector: 'r', fields: { count: 3, agent: 'claude', prompt: ' ' } })
      )
    ).toBe('write what the fan-out should do')
    expect(
      fanOutSubmitBlocker(
        formSlice({
          repoSelector: 'r',
          fields: { count: MAX_FANOUT + 1, agent: 'none', prompt: '' }
        })
      )
    ).toBe(`a fan-out has between ${MIN_FANOUT} and ${MAX_FANOUT} cubes`)
  })

  it('falls back to an English message for an empty child failure', () => {
    expect(summarizeChildFailure('  ')).toBe('could not create the cube')
  })

  it('renders the running counters line in English', () => {
    const model = fanOutViewModel({
      view: 'running',
      parentId: 'w1',
      fields: { count: 1, agent: 'claude', prompt: 'x' },
      repoSelector: 'r',
      batch: [],
      memberStatus: {},
      runId: null
    })
    if (model?.view !== 'running') throw new Error('expected running')
    expect(model.callout).toBe('fan-out · 1 × claude')
    expect(model.counters).toBe(
      '0 working · 0 waiting · 0 spawning · 0 ready · 0 gates · 0 questions'
    )
  })
})
