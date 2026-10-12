import { SCENE_MODE_SWITCHER_CHIPS, connectionDotColor, connectionLabel } from '../hud/hud-model'
import { t, tn } from '../../application/i18n/translate'
import { createKeyboardBar } from '../hud/keyboard-bar'
import type { ConnectionDotTone } from '../hud/hud-model'
import type { KeyboardBarHandle } from '../hud/keyboard-bar'
import type { ConnectionState } from '../../application/scene-store'
import type { SystemHudCounts } from '../../application/system-view-model'
import type { SystemGraphSourceKind } from '../../application/system-graph-source'

/** Tone -> CSS custom property (mirrors hud-overlay.ts's own private DOT_VAR table). */
const DOT_VAR: Record<ConnectionDotTone, string> = {
  accent: '--cubito-accent',
  amber: '--cubito-amber',
  amberDim: '--cubito-amber-dim'
}

export type SystemHudModel = {
  connection: ConnectionState
  branch: string
  counts: SystemHudCounts
  /** Live-validation proof (Wave F4): the WS payloads are E2EE so DevTools can't show which
   *  transport is feeding the graph — the HUD root exposes it as a plain `data-source` attribute. */
  source: SystemGraphSourceKind
  /** False hides the "claude editing" label; omitted means active (scripted demo). */
  agentActive?: boolean
}

export type SystemHudHandle = {
  readonly root: HTMLElement
  readonly keyboardBar: KeyboardBarHandle
  apply(model: SystemHudModel): void
  dispose(): void
}

/**
 * Sistema-en-vivo's own 3-line HUD (design chose a separate block, not the mode-aware shared
 * worktree HUD): connection · branch · agent-activity counters. Reuses hud-model.ts's
 * connectionLabel/connectionDotColor and keyboard-bar.ts's chip renderer — the keyboard bar is
 * exposed separately since it mounts at its own `#keyboard-bar` slot, not inside this root.
 */
export function createSystemHud(doc: Document = document): SystemHudHandle {
  const root = doc.createElement('div')
  root.className = 'cubito-system-hud'
  root.style.pointerEvents = 'none'

  const connectionLine = doc.createElement('div')
  connectionLine.className = 'cubito-hud__line cubito-hud__line--glow'
  const connectionDot = doc.createElement('span')
  connectionDot.className = 'cubito-hud__dot'
  const connectionText = doc.createElement('span')
  connectionLine.appendChild(connectionDot)
  connectionLine.appendChild(connectionText)

  const modeLine = doc.createElement('div')
  modeLine.className = 'cubito-hud__line'

  const countersLine = doc.createElement('div')
  countersLine.className = 'cubito-hud__line'
  const editingLabel = doc.createElement('span')
  editingLabel.className = 'cubito-system-hud__label'
  editingLabel.textContent = t('system.editing')
  const countersRest = doc.createElement('span')
  countersLine.appendChild(editingLabel)
  countersLine.appendChild(countersRest)

  root.appendChild(connectionLine)
  root.appendChild(modeLine)
  root.appendChild(countersLine)

  const keyboardBar = createKeyboardBar(doc)
  // Per VistaSistema.dc.html: the mode switcher, not the graph's hjkl/f/v/s bar (chipsFor).
  keyboardBar.apply(SCENE_MODE_SWITCHER_CHIPS)

  return {
    root,
    keyboardBar,
    apply(model: SystemHudModel) {
      connectionDot.style.backgroundColor = `var(${DOT_VAR[connectionDotColor(model.connection)]})`
      connectionText.textContent = connectionLabel(model.connection)
      modeLine.textContent = `${model.branch} · ${t('system.modeSuffix')}`
      const agentActive = model.agentActive ?? true
      editingLabel.hidden = !agentActive
      const counters = t('system.counters', {
        touched: tn('system.touched', model.counts.tocados),
        created: tn('system.created', model.counts.nuevo)
      })
      countersRest.textContent = agentActive ? counters : counters.replace(/^ · /, '')
      root.dataset.source = model.source
    },
    dispose() {
      root.remove()
      keyboardBar.dispose()
    }
  }
}
