import { afterEach, describe, expect, it } from 'vitest'
import { setActiveLanguage } from './translate'
import { describeFailure, plainFailure } from './user-facing-error'

afterEach(() => setActiveLanguage('es'))

describe('describeFailure', () => {
  it('redacts secrets from the engine detail', () => {
    const failure = describeFailure(
      'workingTree',
      new Error('failed: --token abc123 dcap_0123456789')
    )
    expect(failure.detail).not.toContain('abc123')
    expect(failure.detail).not.toContain('dcap_0123')
  })

  it('leads with the localized action and keeps the engine message as detail', () => {
    expect(describeFailure('workingTree', new Error('fatal: not a git repository'))).toEqual({
      lead: 'no se pudo leer el estado de git',
      detail: 'fatal: not a git repository'
    })
  })

  it('follows the active language and never translates the detail', () => {
    setActiveLanguage('en')
    expect(describeFailure('workingTree', new Error('fatal: nope'))).toEqual({
      lead: "couldn't read the git status",
      detail: 'fatal: nope'
    })
  })

  it('prefers the lead of a known engine code over the action lead', () => {
    expect(describeFailure('reviewCreate', 'gh: bad credentials', 'auth_required').lead).toContain(
      'GH_TOKEN'
    )
    expect(describeFailure('reviewCreate', 'x', 'already_exists').lead).toBe(
      'ya existe una review para esta rama'
    )
    setActiveLanguage('en')
    expect(describeFailure('reviewCreate', 'x', 'push_failed').lead).toBe(
      'the branch could not be pushed'
    )
  })

  it.each([
    'auth_required',
    'already_exists',
    'validation',
    'timeout',
    'unknown_completion',
    'push_failed',
    'unsupported_provider',
    'binary_file'
  ])('has a dedicated lead for code %s in both languages', (code) => {
    const fallback = describeFailure('reviewCreate', 'x').lead
    setActiveLanguage('es')
    expect(describeFailure('reviewCreate', 'x', code).lead).not.toBe(fallback)
    setActiveLanguage('en')
    expect(describeFailure('reviewCreate', 'x', code).lead).not.toBe(
      describeFailure('reviewCreate', 'x').lead
    )
  })

  it('reads the code off the error when none is passed', () => {
    const error = Object.assign(new Error('read refused'), { code: 'binary_file' })
    expect(describeFailure('editorRead', error).lead).toBe(
      describeFailure('editorRead', 'x', 'binary_file').lead
    )
  })

  it('falls back to the action lead for an unknown code', () => {
    expect(describeFailure('workingTree', 'boom', 'weird_code').lead).toBe(
      describeFailure('workingTree', 'boom').lead
    )
  })

  it('drops an empty or redundant detail', () => {
    expect(describeFailure('workingTree', new Error('  ')).detail).toBeNull()
    expect(describeFailure('workingTree', undefined).detail).toBeNull()
  })

  it('stringifies a non-Error rejection as the detail', () => {
    expect(describeFailure('workingTree', 'plain text').detail).toBe('plain text')
  })
})

describe('plainFailure', () => {
  it('is a lead with no engine detail', () => {
    expect(plainFailure('hola')).toEqual({ lead: 'hola', detail: null })
  })
})
