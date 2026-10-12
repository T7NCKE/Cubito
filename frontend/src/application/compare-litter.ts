import { fanOutMemberIds } from './fan-out-model'
import type { SceneState } from './scene-store'
import type { WorktreeGraph, WorktreeId } from '../domain/worktree-graph/types'

type LitterState = Pick<SceneState, 'fanOut' | 'graph' | 'rememberedLitter' | 'selection'>

/** Fan-out litter names are `fanout-<10 hex>` (see cubeNameFor); the host may prefix the branch. */
const FAN_OUT_BRANCH = /(^|\/)fanout-[0-9a-f]{10}$/

const isFanOutChild = (graph: WorktreeGraph, id: WorktreeId): boolean =>
  FAN_OUT_BRANCH.test(graph.nodes.get(id)?.branch ?? '')

/** The running fan-out's children — the only litter worth persisting across a reload. */
export function runningLitterMembers(state: Pick<SceneState, 'fanOut'>): readonly WorktreeId[] {
  return state.fanOut.view === 'running' ? fanOutMemberIds(state.fanOut).slice(1) : []
}

/** Works in a fresh tab or device: the selected node's fan-out children (siblings when a child is
 *  selected), else all its children. */
function derivedLitterMembers(state: LitterState): readonly WorktreeId[] {
  const { graph } = state
  const selected = state.selection.selectedId
  const node = selected === null ? undefined : graph.nodes.get(selected)
  if (!node) return []
  const pick = (ids: readonly WorktreeId[]): readonly WorktreeId[] => {
    const live = ids.filter((id) => graph.nodes.has(id))
    const fanOut = live.filter((id) => isFanOutChild(graph, id))
    return fanOut.length > 0 ? fanOut : live
  }
  const own = pick(node.childIds)
  if (own.length > 0) return own
  const parent = node.parentId === null ? undefined : graph.nodes.get(node.parentId)
  return parent && isFanOutChild(graph, node.id) ? pick(parent.childIds) : []
}

/** Children to compare: the running fan-out's, else the litter remembered across a reload
 *  (only members still in the graph), else what the graph shows under the selected node. */
export function compareLitterMembers(state: LitterState): readonly WorktreeId[] {
  const running = runningLitterMembers(state)
  if (state.fanOut.view === 'running') return running
  const remembered = state.rememberedLitter.filter((id) => state.graph.nodes.has(id))
  return remembered.length > 0 ? remembered : derivedLitterMembers(state)
}
