export const REDACTED = '‹redacted›'

const SECRET_FLAG = '(?:token|secret|capability|api-key|apikey|password|passwd)'

// Why: order matters — flag/env/bearer rules keep their label, token-shape rules catch the rest.
const RULES: readonly [RegExp, string][] = [
  [
    new RegExp(
      `(--[\\w-]*${SECRET_FLAG}[\\w-]*(?:=|\\s+))(?:"[^"]*"|'[^']*'|(?!‹)[^\\s"']+)`,
      'gi'
    ),
    `$1${REDACTED}`
  ],
  [
    /\b([A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD)=)(?:"[^"]*"|'[^']*'|(?!‹)[^\s"']+)/g,
    `$1${REDACTED}`
  ],
  [/\b(Bearer\s+)(?!‹)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`],
  [/\bdcap_[A-Za-z0-9_-]+/g, REDACTED],
  [
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,})/g,
    REDACTED
  ],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, REDACTED]
]

/** Masks capability tokens and common credentials in text the engine hands us for display. */
export function redactSecrets(text: string): string {
  return RULES.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text)
}
