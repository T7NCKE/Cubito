import { t } from '../../application/i18n/translate'
import type {
  TerminalPlacement,
  TerminalSessionStatus,
  TerminalsState
} from '../../application/terminal-session-model'
import { redactSecrets } from '../../domain/secret-redaction'
import type { WorktreeId } from '../../domain/worktree-graph/types'

/** Semantic chrome tones — the DOM writer maps these to `--cubito-*` custom properties. */
export type PanelTone = 'info' | 'panelSurface' | 'panelBorder'

export type TerminalPanelTab = { streamId: number; label: string }

export type TerminalPanelModel = {
  nodeId: WorktreeId
  header: string
  placement: TerminalPlacement
  focused: boolean
  connectorVisible: boolean
  status: TerminalSessionStatus
  tabs: readonly TerminalPanelTab[]
  activeTabIndex: number
  tone: { connector: PanelTone; surface: PanelTone; border: PanelTone }
}

/**
 * Pure render model for the in-scene/HUD terminal panel (design Area 6). Bytes never flow
 * through here — this only projects lifecycle/placement metadata from the terminals slice.
 */
export function terminalPanelModel(state: TerminalsState): TerminalPanelModel | null {
  const panel = state.activePanel
  if (!panel) return null

  const tabStreamIds = state.byNode.get(panel.nodeId) ?? []
  const activeStreamId = tabStreamIds[panel.sessionIndex]
  const activeSession =
    activeStreamId !== undefined ? state.sessions.get(activeStreamId) : undefined
  if (!activeSession) return null

  const tabs = tabStreamIds.map((streamId) => ({
    streamId,
    label: redactSecrets(state.sessions.get(streamId)?.title ?? t('terminal.fallbackTitle'))
  }))

  return {
    nodeId: panel.nodeId,
    header: t('terminal.header', {
      index: panel.sessionIndex + 1,
      total: tabStreamIds.length,
      title: redactSecrets(activeSession.title ?? t('terminal.fallbackTitle'))
    }),
    placement: panel.placement,
    focused: panel.focused,
    connectorVisible: panel.placement === 'scene',
    status: activeSession.status,
    tabs,
    activeTabIndex: panel.sessionIndex,
    tone: { connector: 'info', surface: 'panelSurface', border: 'panelBorder' }
  }
}
