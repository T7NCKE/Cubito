import { countNodeStates } from '../theme/node-state'
import { t, tn } from '../../application/i18n/translate'
import type { MessageKey } from '../../application/i18n/messages/en'
import type { ConnectionState, SceneState } from '../../application/scene-store'
import type { TerminalsState } from '../../application/terminal-session-model'
import type { FailureMessage } from '../../application/i18n/user-facing-error'
import type { WorktreeGraph } from '../../domain/worktree-graph/types'

/** Semantic palette token names — never raw hex; the DOM writer maps these to CSS vars. */
export type ConnectionDotTone = 'accent' | 'amber' | 'amberDim'

export type HudChip = { key: string; description: string }

/** Lazy description: resolved per read, so module-level chip lists never freeze a language. */
const chip = (key: string, messageKey: MessageKey): HudChip => ({
  key,
  get description() {
    return t(messageKey)
  }
})

/** The [g][x][d][c][t] switcher every scene-replacing mode (sistema/diff/compare) renders in its
 *  own keyboard bar — one list so a new mode's chip lands in all of them at once. */
export const SCENE_MODE_SWITCHER_CHIPS: readonly HudChip[] = [
  chip('g', 'keys.worktreeGraph'),
  chip('x', 'keys.liveSystem'),
  chip('d', 'keys.diff'),
  chip('c', 'keys.compareLitter'),
  chip('t', 'keys.terminal')
]

/** Compare's bar: the litter-navigation chip first, then the shared mode switcher. Winner and
 *  merge stay mouse-only (design C4), so no chip claims Enter or m. */
export const COMPARE_CHIPS: readonly HudChip[] = [
  chip('h l', 'keys.prevNextChild'),
  ...SCENE_MODE_SWITCHER_CHIPS
]

/** Localized copy for the repo/counters lines — the DOM writer may not import application/*. */
export type HudText = { repo: string; countersPrefix: string; countersWaiting: string }

export type HudModel = {
  connection: { label: string; dotColor: ConnectionDotTone }
  repo: { displayName: string; nodeCount: number } | null
  counters: ReturnType<typeof countNodeStates>
  text: HudText
  chips: readonly HudChip[]
  /** Failed graph sync while connected — non-blocking line under the counters. */
  syncNotice: FailureMessage | null
}

export const connectionLabel = (connection: ConnectionState): string => {
  switch (connection.state) {
    case 'connecting':
      return t('hud.connecting')
    case 'connected':
      return t('hud.connected', { runtimeId: connection.runtimeId })
    case 'reconnecting':
      return t('hud.reconnecting', { attempt: connection.attempt })
    case 'down':
      return t('hud.disconnected', { reason: connection.reason })
  }
}

export const connectionDotColor = (connection: ConnectionState): ConnectionDotTone => {
  switch (connection.state) {
    case 'connecting':
      return 'amber'
    case 'connected':
      return 'accent'
    case 'reconnecting':
      return 'amber'
    case 'down':
      return 'amberDim'
  }
}

/** Terminal-aware chips (design Area 8): no terminal -> `[t]`; scene placement -> pin/tab/exit;
 *  hud placement -> its escena/close counterparts. Reflects `TerminalsState` only, no DOM. */
const terminalChips = (
  terminals: TerminalsState,
  selectedId: unknown,
  connected: boolean
): readonly HudChip[] => {
  const panel = terminals.activePanel
  if (!panel) {
    // Why: `t` needs a live host — advertising it in demo/offline mode promises a dead key.
    return selectedId === null || !connected ? [] : [chip('t', 'keys.terminal')]
  }
  const tabs = terminals.byNode.get(panel.nodeId) ?? []
  if (panel.placement === 'scene') {
    const chips: HudChip[] = [chip('p', 'keys.pin')]
    if (tabs.length > 1) {
      chips.push(chip('⇥', 'keys.otherTerminal'))
    }
    chips.push(chip('Ctrl+]', 'keys.exit'))
    return chips
  }
  const chips: HudChip[] = [chip('esc', 'keys.closePanel')]
  if (tabs.length > 1) {
    chips.push(chip('⇥', 'keys.otherTerminal'))
  }
  chips.push(chip('p', 'keys.scene'))
  return chips
}

const countNodesInRepo = (graph: WorktreeGraph, repoId: string): number => {
  let count = 0
  for (const node of graph.nodes.values()) {
    if (node.repoId === repoId) count++
  }
  return count
}

const activeRepoLine = (state: SceneState): HudModel['repo'] => {
  const { activeRepoId, list } = state.repos
  if (activeRepoId === null) return null
  const repo = list.find((candidate) => candidate.id === activeRepoId)
  if (!repo) return null
  return { displayName: repo.displayName, nodeCount: countNodesInRepo(state.graph, activeRepoId) }
}

const chipsFor = (platform: { isMac: boolean }): readonly HudChip[] => [
  chip('hjkl', 'keys.navigate'),
  chip('f', 'keys.focus'),
  chip('v', 'keys.overview'),
  chip('s', 'keys.spawn'),
  chip(platform.isMac ? '⌘K' : 'Ctrl+K', 'keys.palette'),
  chip(platform.isMac ? '⌘P' : 'Ctrl+P', 'keys.projects')
]

export const hudText = (repo: HudModel['repo'], counters: HudModel['counters']): HudText => ({
  repo:
    repo === null
      ? t('hud.noRepo')
      : t('hud.repoLine', { name: repo.displayName, nodes: tn('hud.nodes', repo.nodeCount) }),
  countersPrefix: t('hud.countersPrefix', {
    nodes: tn('hud.nodes', counters.total),
    agents: tn('hud.activeAgents', counters.working)
  }),
  countersWaiting: t('hud.countersWaiting', { count: counters['waiting-input'] })
})

export function hudModel(state: SceneState, platform: { isMac: boolean }): HudModel {
  const repo = activeRepoLine(state)
  const counters = countNodeStates(state.graph)
  return {
    connection: {
      label: connectionLabel(state.connection),
      dotColor: connectionDotColor(state.connection)
    },
    repo,
    counters,
    text: hudText(repo, counters),
    // Why: a down connection already says why nothing refreshes — don't stack a second line on it.
    syncNotice:
      state.sync.state === 'error' && state.connection.state === 'connected'
        ? state.sync.message
        : null,
    chips: [
      ...chipsFor(platform),
      ...terminalChips(
        state.terminals,
        state.selection.selectedId,
        state.connection.state === 'connected'
      )
    ]
  }
}
