import { runningLitterMembers } from './application/compare-litter'
import { readRememberedLitter, rememberLitter } from './application/litter-memory'
import type { LitterStorage } from './application/litter-memory'
import type { SceneStore } from './application/scene-store'

/** Restores the per-tab litter at startup, then keeps it in sync with the running fan-out. */
export function bindLitterMemory(store: SceneStore, storage: LitterStorage | null): () => void {
  store.update({ rememberedLitter: readRememberedLitter(storage) })
  return store.subscribe((state) => {
    // Only a live fan-out redefines the litter; otherwise keep what was restored.
    if (state.fanOut.view !== 'running') return
    const members = runningLitterMembers(state)
    const same =
      members.length === state.rememberedLitter.length &&
      members.every((id, index) => id === state.rememberedLitter[index])
    if (members.length === 0 || same) return
    rememberLitter(storage, members)
    store.update({ rememberedLitter: members })
  })
}
