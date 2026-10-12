import { fanOutMemberIds } from './fan-out-model'
import type { SceneState } from './scene-store'
import type { WorktreeId } from '../domain/worktree-graph/types'

/** Children to compare: the running fan-out's, else the litter remembered across a reload
 *  (only members still in the graph). */
export function compareLitterMembers(
  state: Pick<SceneState, 'fanOut' | 'graph' | 'rememberedLitter'>
): readonly WorktreeId[] {
  if (state.fanOut.view === 'running') return fanOutMemberIds(state.fanOut).slice(1)
  return state.rememberedLitter.filter((id) => state.graph.nodes.has(id))
}
