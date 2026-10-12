import type {
  MergeBlockReason,
  MergeWinnerResult,
  ParentDependencySetupResult,
  ParentWorkingTreeSyncResult,
  RuntimeGateway
} from '../../application/ports/runtime-gateway'
import type { RpcCaller } from './orcad-gateway'

export type GitMergeMethods = Pick<RuntimeGateway, 'gitMergeWinnerIntoParent'>

/** Projects a raw `workingTree` sub-shape; malformed/missing -> undefined (best-effort field,
 *  should not fail the whole merge result). */
function toWorkingTreeResult(workingTree: unknown): ParentWorkingTreeSyncResult | undefined {
  if (typeof workingTree !== 'object' || workingTree === null) {
    return undefined
  }
  const w = workingTree as { status?: unknown; reason?: unknown; message?: unknown }
  if (w.status === 'synced') {
    return { status: 'synced' }
  }
  if (w.status === 'skipped' && w.reason === 'dirty') {
    return { status: 'skipped', reason: 'dirty' }
  }
  if (w.status === 'failed' && typeof w.message === 'string') {
    const previousOid = (workingTree as { previousOid?: unknown }).previousOid
    return {
      status: 'failed',
      message: w.message,
      ...(typeof previousOid === 'string' ? { previousOid } : {})
    }
  }
  return undefined
}

/** Projects a raw `dependencySetup` sub-shape; malformed/missing -> undefined (best-effort field). */
function toDependencySetupResult(value: unknown): ParentDependencySetupResult | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  return (value as { status?: unknown }).status === 'started' ? { status: 'started' } : undefined
}

const BLOCK_REASONS: readonly MergeBlockReason[] = [
  'untracked-overwrite',
  'ignored-overwrite',
  'dirty-parent',
  'sync-refused',
  'sync-failed'
]

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

/** Projects a raw `git.mergeWinnerIntoParent` result onto the local `MergeWinnerResult` shape. */
function toMergeWinnerResult(result: {
  outcome?: unknown
  commitOid?: unknown
  files?: unknown
  reason?: unknown
  paths?: unknown
  message?: unknown
  workingTree?: unknown
  dependencySetup?: unknown
}): MergeWinnerResult {
  if (result.outcome === 'clean' && typeof result.commitOid === 'string') {
    const workingTree = toWorkingTreeResult(result.workingTree)
    const dependencySetup = toDependencySetupResult(result.dependencySetup)
    return {
      outcome: 'clean',
      commitOid: result.commitOid,
      ...(workingTree ? { workingTree } : {}),
      ...(dependencySetup ? { dependencySetup } : {})
    }
  }
  if (result.outcome === 'conflict' && isStringList(result.files)) {
    return { outcome: 'conflict', files: result.files }
  }
  if (result.outcome === 'blocked' && isStringList(result.paths)) {
    const reason = BLOCK_REASONS.find((known) => known === result.reason) ?? 'sync-refused'
    return {
      outcome: 'blocked',
      reason,
      paths: result.paths,
      ...(typeof result.message === 'string' ? { message: result.message } : {})
    }
  }
  if (result.outcome === 'already-merged' && typeof result.commitOid === 'string') {
    return { outcome: 'already-merged', commitOid: result.commitOid }
  }
  throw new Error('git.mergeWinnerIntoParent returned a malformed result')
}

/**
 * git.* gateway methods (Change E), kept out of orcad-gateway.ts (267 lines — max-lines) as its
 * own module, mirroring orcad-orchestration-gateway.ts's compose-in pattern.
 */
export function createGitMergeMethods(connection: { call: RpcCaller }): GitMergeMethods {
  return {
    async gitMergeWinnerIntoParent(parent, winner, message, syncWorkingTree) {
      const response = await connection.call('git.mergeWinnerIntoParent', {
        parent,
        winner,
        ...(message !== undefined ? { message } : {}),
        ...(syncWorkingTree === true ? { syncWorkingTree: true } : {})
      })
      return toMergeWinnerResult(response.result as Parameters<typeof toMergeWinnerResult>[0])
    }
  }
}
