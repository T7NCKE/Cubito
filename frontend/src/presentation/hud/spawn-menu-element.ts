import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import type { SpawnChipTone, SpawnRadialViewModel } from './spawn-view-model'

const TONE_VAR: Record<SpawnChipTone, string> = {
  active: '--cubito-accent',
  disabled: '--cubito-text-dim'
}

export type SpawnMenuHandle = {
  readonly object: CSS2DObject
  apply(model: SpawnRadialViewModel): void
  /** Gap (px) from the node center to the first chip; null restores the CSS default. */
  setClearance(px: number | null): void
  dispose(): void
}

/**
 * Radial chip menu (design Area 3), a CSS2DObject anchored to the selected node — built the
 * same way as node-label-element.ts. Positioning is the controller's job (tick()); this only
 * paints chip content/tone. `doc` is injectable so chip rendering is unit-testable without a
 * real DOM (keyboard-bar.ts's convention), unlike terminal-panel-element.ts's xterm instance.
 */
export function createSpawnMenu(doc: Document = document): SpawnMenuHandle {
  const root = doc.createElement('div')
  root.className = 'cubito-spawn-menu'
  root.style.pointerEvents = 'none'

  const object = new CSS2DObject(root)
  // Why: centred on the node it would sit on top of the selected cube; pin its left edge to it.
  object.center.set(0, 0.5)

  return {
    object,
    apply(model: SpawnRadialViewModel) {
      root.replaceChildren()
      for (const chip of model.chips) {
        const chipElement = doc.createElement('div')
        chipElement.className = `cubito-spawn-chip cubito-spawn-chip--${chip.tone}`
        chipElement.style.color = `var(${TONE_VAR[chip.tone]})`

        const key = doc.createElement('span')
        key.className = 'cubito-spawn-chip__key'
        key.textContent = `[${chip.key}]`

        const label = doc.createElement('span')
        label.className = 'cubito-spawn-chip__label'
        label.textContent = chip.label

        chipElement.appendChild(key)
        chipElement.appendChild(label)
        root.appendChild(chipElement)
      }
    },
    setClearance(px) {
      root.style.paddingLeft = px === null ? '' : `${px}px`
    },
    dispose() {
      root.remove()
    }
  }
}
