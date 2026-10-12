import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REDACTED, redactSecrets } from './secret-redaction'

describe('redactSecrets', () => {
  it('masks dispatch capability tokens in a full orca command', () => {
    const text =
      'orca orchestration send --to term_ab12 --subject done --dispatch-capability dcap_9f8e7d6c5b4a39281706f5e4d3c2b1a0 --json'
    const out = redactSecrets(text)
    expect(out).not.toContain('dcap_9f8e')
    expect(out).toBe(
      `orca orchestration send --to term_ab12 --subject done --dispatch-capability ${REDACTED} --json`
    )
  })

  it('masks a bare dcap_ token anywhere', () => {
    expect(redactSecrets('capability dcap_abcDEF123456_-xyz leaked')).toBe(
      `capability ${REDACTED} leaked`
    )
  })

  it.each([
    ['--token abc123SECRET', `--token ${REDACTED}`],
    ['--token=abc123SECRET', `--token=${REDACTED}`],
    ['--secret "s3 cr3t"', `--secret ${REDACTED}`],
    ["--api-key 'k-1234'", `--api-key ${REDACTED}`],
    ['--password hunter2 --verbose', `--password ${REDACTED} --verbose`],
    ['--capability cap_xyz', `--capability ${REDACTED}`]
  ])('masks flag value %s', (input, expected) => {
    expect(redactSecrets(input)).toBe(expected)
  })

  it('masks secret-looking env assignments but keeps the name', () => {
    expect(
      redactSecrets('GITHUB_TOKEN=abc123 AWS_SECRET_ACCESS_KEY=zzz OPENAI_API_KEY=sk-x npm test')
    ).toBe(
      `GITHUB_TOKEN=${REDACTED} AWS_SECRET_ACCESS_KEY=${REDACTED} OPENAI_API_KEY=${REDACTED} npm test`
    )
  })

  it('leaves non-secret env assignments alone', () => {
    expect(redactSecrets('NODE_ENV=production PORT=3000 node app.js')).toBe(
      'NODE_ENV=production PORT=3000 node app.js'
    )
  })

  it('masks bearer tokens', () => {
    expect(redactSecrets('curl -H "Authorization: Bearer eyJhbGciOi.abc-def_1" https://x')).toBe(
      `curl -H "Authorization: Bearer ${REDACTED}" https://x`
    )
  })

  it.each([
    'ghp_' + 'a'.repeat(36),
    'gho_' + 'B'.repeat(36),
    'github_pat_' + 'c1'.repeat(20),
    'glpat-' + 'd'.repeat(20),
    'sk-' + 'e'.repeat(32),
    'sk-ant-api03-' + 'f'.repeat(40)
  ])('masks provider token %s', (token) => {
    expect(redactSecrets(`git push https://x:${token}@host/r.git`)).toBe(
      `git push https://x:${REDACTED}@host/r.git`
    )
  })

  it('leaves ordinary text, paths and commands untouched', () => {
    const text = 'pnpm test src/auth/token-service.ts && git status --short'
    expect(redactSecrets(text)).toBe(text)
  })

  it('is idempotent', () => {
    const once = redactSecrets('--token abc dcap_123456')
    expect(redactSecrets(once)).toBe(once)
  })
})

// Why: shared with src/shared/cubito-secret-redaction.test.ts so the engine-side copy cannot drift.
const sharedSamples = JSON.parse(
  readFileSync(
    new URL('../../../src/shared/cubito-secret-redaction-samples.json', import.meta.url),
    'utf8'
  )
) as { input: string; expected: string }[]

describe('redactSecrets shared vectors', () => {
  it.each(sharedSamples)('redacts $input', ({ input, expected }) => {
    expect(redactSecrets(input)).toBe(expected)
  })
})
