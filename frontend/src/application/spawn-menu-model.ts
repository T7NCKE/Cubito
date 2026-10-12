import type { WorktreeId } from '../domain/worktree-graph/types'
import type { CreateWorktreeInput, SpawnAgent } from './ports/runtime-gateway'
import type { FailureMessage } from './i18n/user-facing-error'

export type SpawnFormFields = {
  name: string
  baseBranch: string
  agent: SpawnAgent
  prompt: string
}

const emptyFormFields = (): SpawnFormFields => ({
  name: '',
  baseBranch: '',
  agent: 'none',
  prompt: ''
})

export type SpawnMenuStatus = 'idle' | 'submitting' | 'error'

/** Spawn's own state machine: closed → radial (anchored to a node) → form, or closed → form direct (rootless). */
export type SpawnMenuSlice =
  | { view: 'closed'; repoSelector: string | null }
  | { view: 'radial'; nodeId: WorktreeId; repoSelector: string | null }
  | {
      view: 'form'
      parentId: WorktreeId | null
      fields: SpawnFormFields
      status: SpawnMenuStatus
      errorMessage?: FailureMessage
      repoSelector: string | null
    }

export const emptySpawnMenuSlice = (): SpawnMenuSlice => ({ view: 'closed', repoSelector: null })

export type SpawnMenuAction =
  | { type: 'open-for-node'; nodeId: WorktreeId }
  | { type: 'open-rootless' }
  | { type: 'radial-select' }
  | { type: 'update-field'; field: keyof SpawnFormFields; value: string }
  | { type: 'set-repo-selector'; repoSelector: string }
  | { type: 'submit' }
  | { type: 'submit-ok' }
  | { type: 'submit-error'; message: FailureMessage }
  | { type: 'cancel' }

export function reduceSpawnMenu(slice: SpawnMenuSlice, action: SpawnMenuAction): SpawnMenuSlice {
  switch (action.type) {
    case 'open-for-node':
      return { view: 'radial', nodeId: action.nodeId, repoSelector: slice.repoSelector }
    case 'open-rootless':
      return openForm(slice, null)
    case 'radial-select':
      return slice.view === 'radial' ? openForm(slice, slice.nodeId) : slice
    case 'update-field':
      return slice.view === 'form'
        ? { ...slice, fields: { ...slice.fields, [action.field]: action.value } }
        : slice
    case 'set-repo-selector':
      return { ...slice, repoSelector: action.repoSelector }
    case 'submit':
      return startSubmit(slice)
    case 'submit-ok':
      return { view: 'closed', repoSelector: slice.repoSelector }
    case 'submit-error':
      return slice.view === 'form'
        ? { ...slice, status: 'error', errorMessage: action.message }
        : slice
    case 'cancel':
      return { view: 'closed', repoSelector: slice.repoSelector }
    default:
      return slice
  }
}

function openForm(slice: SpawnMenuSlice, parentId: WorktreeId | null): SpawnMenuSlice {
  return {
    view: 'form',
    parentId,
    fields: emptyFormFields(),
    status: 'idle',
    repoSelector: slice.repoSelector
  }
}

function startSubmit(slice: SpawnMenuSlice): SpawnMenuSlice {
  if (slice.view !== 'form' || slice.status === 'submitting') return slice
  const { errorMessage: _errorMessage, ...rest } = slice
  return { ...rest, status: 'submitting' }
}

/** Maps form fields + lineage + resolved repo selector to `worktree.create` params (SPAWN-003 omit table). */
/** wt-<mutationId prefix> (language-neutral: persisted git refs must not depend on UI language) — used when the name field is left empty. */
export function generatedWorktreeName(mutationId: string): string {
  return `wt-${mutationId.replace(/-/g, '').slice(0, 10)}`
}

export function toCreateWorktreeInput(
  fields: SpawnFormFields,
  parentId: WorktreeId | null,
  repoSelector: string
): CreateWorktreeInput {
  const input: CreateWorktreeInput = { repo: repoSelector }
  if (fields.name.trim() !== '') input.name = fields.name
  if (fields.baseBranch.trim() !== '') input.baseBranch = fields.baseBranch
  if (fields.agent !== 'none') {
    input.startupAgent = fields.agent
    if (fields.prompt.trim() !== '') input.startupPrompt = fields.prompt
  }
  if (parentId !== null) input.parentWorktree = parentId
  return input
}
