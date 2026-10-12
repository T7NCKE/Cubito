import { t } from '../../application/i18n/translate'
import { plainFailure } from '../../application/i18n/user-facing-error'
import type { FailureMessage } from '../../application/i18n/user-facing-error'
import type { SpawnMenuSlice } from '../../application/spawn-menu-model'
import type { SpawnAgent } from '../../application/ports/runtime-gateway'
import type { WorktreeGraph } from '../../domain/worktree-graph/types'
import { fromParentLabel } from './node-label-model'

export type SpawnChipTone = 'active' | 'disabled'
export type SpawnChip = {
  readonly key: string
  readonly label: string
  readonly tone: SpawnChipTone
}

/** SPAWN-002/fan-out wave 5: "spawn hijo" and "fan-out" are in scope — terminal/archivar render inert. */
const radialChips = (): readonly SpawnChip[] => [
  { key: 's', label: t('spawn.radial.child'), tone: 'active' },
  { key: 'F', label: t('spawn.radial.fanOut'), tone: 'active' },
  { key: 't', label: t('spawn.radial.terminal'), tone: 'disabled' },
  { key: 'a', label: t('spawn.radial.archive'), tone: 'disabled' }
]

export type SpawnRadialViewModel = { readonly view: 'radial'; readonly chips: readonly SpawnChip[] }

export type SpawnFieldViewModel = { readonly value: string; readonly enabled: boolean }

export type SpawnFormViewModel = {
  readonly view: 'form'
  readonly title: string
  readonly name: SpawnFieldViewModel
  readonly agent: { readonly value: SpawnAgent; readonly enabled: boolean }
  readonly baseBranch: SpawnFieldViewModel
  readonly prompt: SpawnFieldViewModel
  readonly submitLabel: string
  readonly submitEnabled: boolean
  readonly errorMessage: FailureMessage | null
  /** Non-blocking note shown when the target repo has no setup command; null otherwise. */
  readonly setupHint: string | null
}

export type SpawnViewModel = SpawnRadialViewModel | SpawnFormViewModel | null

/**
 * Pure render model for the spawn radial/form (SPAWN-002/003/004). DOM projection lives in
 * spawn-menu-element.ts/spawn-form-element.ts; this owns only content, tone and enablement.
 */
export function spawnViewModel(
  slice: SpawnMenuSlice,
  graph: WorktreeGraph,
  setupHint: string | null = null
): SpawnViewModel {
  if (slice.view === 'closed') return null
  if (slice.view === 'radial') return { view: 'radial', chips: radialChips() }

  const submitting = slice.status === 'submitting'
  const parentBranch =
    slice.parentId !== null ? (graph.nodes.get(slice.parentId)?.branch ?? null) : null
  const agentActive = slice.fields.agent !== 'none'

  return {
    view: 'form',
    title: t('spawn.title', { from: fromParentLabel(parentBranch) }),
    name: { value: slice.fields.name, enabled: !submitting },
    agent: { value: slice.fields.agent, enabled: !submitting },
    baseBranch: { value: slice.fields.baseBranch, enabled: !submitting },
    prompt: { value: slice.fields.prompt, enabled: agentActive && !submitting },
    submitLabel: submitting ? t('spawn.submitting') : t('spawn.submit'),
    submitEnabled: !submitting,
    errorMessage:
      slice.status === 'error' ? (slice.errorMessage ?? plainFailure(t('failure.unknown'))) : null,
    setupHint
  }
}
