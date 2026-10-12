import { Terminal } from '@xterm/xterm'
import type { IDisposable, ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css' // base styles: hides the helper textarea, lays out rows/cursor
import { FitAddon } from '@xterm/addon-fit'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import type { TerminalPanelModel } from './terminal-panel-model'
import { createConnectedFocus } from './connected-focus-scheduler'

/** Chrome tone -> CSS custom property (kebab convention, same table shape as node-label-element.ts). */
const CHROME_VAR = {
  panelSurface: '--cubito-panel-surface',
  panelBorder: '--cubito-panel-border'
} as const

/** xterm's canvas renderer needs resolved colours, not `var()` refs, so read them once at
 *  construction from the already-applied theme (applyCssTheme runs before any panel exists). */
const readThemeColor = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

const xtermTheme = (): ITheme => ({
  background: readThemeColor(CHROME_VAR.panelSurface),
  foreground: readThemeColor('--cubito-text-primary'),
  cursor: readThemeColor('--cubito-accent')
})

/** Ctrl+] (tmux-detach idiom, platform-neutral per AGENTS.md) — the only chord that exits
 *  terminal focus back to the graph; Esc must never be caught here, it always reaches the PTY. */
export function isTerminalExitChord(key: string, ctrlKey: boolean): boolean {
  return ctrlKey && key === ']'
}

/** xterm's `attachCustomKeyEventHandler` predicate (design Area 8/P6.3), extracted pure for
 *  testing without a DOM: `false` stops xterm processing the event (and fires `onExit`);
 *  any other key — Esc included — returns `true` so xterm forwards it to the PTY untouched. */
export function terminalCustomKeyEventHandler(
  event: { type: string; key: string; ctrlKey: boolean },
  onExit: () => void
): boolean {
  if (event.type === 'keydown' && isTerminalExitChord(event.key, event.ctrlKey)) {
    onExit()
    return false
  }
  return true
}

export type TerminalPanelHandle = {
  readonly object: CSS2DObject
  readonly element: HTMLElement
  apply(model: TerminalPanelModel): void
  write(bytes: Uint8Array): void
  reset(): void
  fit(): void
  /** Current xterm grid size — sent as the Subscribe viewport so orcad sizes the PTY. */
  dimensions(): { cols: number; rows: number }
  onData(callback: (data: string) => void): () => void
  onResize(callback: (cols: number, rows: number) => void): () => void
  focus(): void
  blur(): void
  /** Overrides the CSS size (null restores it) and refits the shell when the size changed. */
  setSize(size: { width: number; height: number } | null): void
  /** Hidden panels keep their layout (still measurable) but paint nothing. */
  setPlaced(placed: boolean): void
  dispose(): void
}

/**
 * xterm.js instance hosted in a CSS2DObject (design Area 6), built the same way as
 * node-label-element.ts: plain DOM construction, `var(--cubito-*)` only, dispose on teardown.
 * Untestable under `environment:'node'` (no `document`/canvas) — wiring lives in the controller.
 * `onExit` fires on the Ctrl+] chord (see `terminalCustomKeyEventHandler` above) so the
 * controller can blur the panel and hand focus back to the graph.
 */
export function createTerminalPanel(onExit: () => void): TerminalPanelHandle {
  const root = document.createElement('div')
  root.className = 'cubito-terminal-panel'
  root.style.backgroundColor = `var(${CHROME_VAR.panelSurface})`
  root.style.border = `1px solid var(${CHROME_VAR.panelBorder})`
  root.style.fontFamily = "'Fira Code', monospace"

  const header = document.createElement('div')
  header.className = 'cubito-terminal-panel__header'
  header.style.color = 'var(--cubito-text-dim)'

  const body = document.createElement('div')
  body.className = 'cubito-terminal-panel__body'

  root.appendChild(header)
  root.appendChild(body)

  const term = new Terminal({ theme: xtermTheme(), fontFamily: "'Fira Code', monospace" })
  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(body)
  term.attachCustomKeyEventHandler((event) => terminalCustomKeyEventHandler(event, onExit))

  const connectedFocus = createConnectedFocus({
    isConnected: () => root.isConnected,
    focus: () => term.focus(),
    schedule: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle)
  })

  const object = new CSS2DObject(root)
  let sizeKey = ''

  return {
    object,
    element: root,
    apply(model: TerminalPanelModel) {
      header.textContent = model.header
      root.classList.toggle('cubito-terminal-panel--focused', model.focused)
      root.classList.toggle('cubito-terminal-panel--live', model.status === 'live')
    },
    write(bytes: Uint8Array) {
      term.write(bytes)
    },
    reset() {
      term.reset()
    },
    fit() {
      fitAddon.fit()
    },
    dimensions() {
      return { cols: term.cols, rows: term.rows }
    },
    onData(callback: (data: string) => void): () => void {
      const subscription: IDisposable = term.onData(callback)
      return () => subscription.dispose()
    },
    onResize(callback: (cols: number, rows: number) => void): () => void {
      const subscription: IDisposable = term.onResize(({ cols, rows }) => callback(cols, rows))
      return () => subscription.dispose()
    },
    focus() {
      connectedFocus.request()
    },
    setSize(size) {
      const key = size === null ? '' : `${size.width}x${size.height}`
      if (key === sizeKey) return
      sizeKey = key
      root.style.width = size === null ? '' : `${size.width}px`
      root.style.height = size === null ? '' : `${size.height}px`
      fitAddon.fit()
    },
    setPlaced(placed: boolean) {
      root.style.visibility = placed ? '' : 'hidden'
    },
    blur() {
      connectedFocus.cancel()
      term.blur()
    },
    dispose() {
      connectedFocus.cancel()
      term.dispose()
      root.remove()
    }
  }
}
