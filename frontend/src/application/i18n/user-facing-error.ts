import { redactSecrets } from '../../domain/secret-redaction'
import type { MessageKey } from './messages/en'
import { t } from './translate'

/** Localized "what failed" plus the engine's own message, never translated (searchable). */
export type FailureMessage = { lead: string; detail: string | null }

/** A failure with no engine detail (our own copy). */
export const plainFailure = (lead: string): FailureMessage => ({ lead, detail: null })

export type FailureAction = MessageKey extends infer K
  ? K extends `failure.action.${infer A}`
    ? A
    : never
  : never

// Why: auth_required already has long-form guidance under the review copy.
const CODE_LEADS: Readonly<Record<string, MessageKey>> = {
  auth_required: 'review.authRequired',
  already_exists: 'failure.code.already_exists',
  validation: 'failure.code.validation',
  timeout: 'failure.code.timeout',
  unknown_completion: 'failure.code.unknown_completion',
  push_failed: 'failure.code.push_failed',
  unsupported_provider: 'failure.code.unsupported_provider',
  binary_file: 'failure.code.binary_file'
}

const codeOf = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? typeof error.code === 'string'
      ? error.code
      : undefined
    : undefined

const messageOf = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === 'string' || typeof error === 'number'
      ? String(error)
      : ''

/** Lead from the engine code when it has copy, else from the failed action; detail stays raw. */
export function describeFailure(
  action: FailureAction,
  error: unknown,
  code?: string
): FailureMessage {
  const codeKey = CODE_LEADS[code ?? codeOf(error) ?? '']
  const lead = t(codeKey ?? `failure.action.${action}`)
  const detail = redactSecrets(messageOf(error).trim())
  return { lead, detail: detail === '' || detail === lead ? null : detail }
}
