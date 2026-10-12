import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { redactSecrets } from './cubito-secret-redaction'

// Why: the same vectors drive frontend/src/domain/secret-redaction.test.ts, keeping both rule sets in lockstep.
const samples = JSON.parse(
  readFileSync(join(__dirname, 'cubito-secret-redaction-samples.json'), 'utf8')
) as { input: string; expected: string }[]

describe('redactSecrets (engine side)', () => {
  it.each(samples)('redacts $input', ({ input, expected }) => {
    expect(redactSecrets(input)).toBe(expected)
  })

  it('is idempotent on every sample', () => {
    for (const { expected } of samples) {
      expect(redactSecrets(expected)).toBe(expected)
    }
  })
})
