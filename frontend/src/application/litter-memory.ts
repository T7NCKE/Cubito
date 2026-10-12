import type { WorktreeId } from '../domain/worktree-graph/types'

export const LITTER_STORAGE_KEY = 'cubito.litter'

export type LitterStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Per-tab (sessionStorage) so a reload keeps compare reachable; blocked storage degrades to none. */
export function readRememberedLitter(storage: LitterStorage | null): readonly WorktreeId[] {
  if (!storage) return []
  try {
    const parsed: unknown = JSON.parse(storage.getItem(LITTER_STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) && parsed.every((id) => typeof id === 'string') ? parsed : []
  } catch {
    return []
  }
}

export function rememberLitter(
  storage: LitterStorage | null,
  members: readonly WorktreeId[]
): void {
  if (!storage) return
  try {
    if (members.length === 0) storage.removeItem(LITTER_STORAGE_KEY)
    else storage.setItem(LITTER_STORAGE_KEY, JSON.stringify(members))
  } catch {
    // storage full or blocked — compare simply won't survive a reload
  }
}
