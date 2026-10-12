import type { LabelRect } from './label-collision-model'
import type { PanelBox, ScreenXY } from './terminal-panel-viewport-clamp'
import { clampPanelToViewport } from './terminal-panel-viewport-clamp'

const intersects = (a: LabelRect, b: LabelRect): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

const rectAround = (center: ScreenXY, panel: PanelBox): LabelRect => ({
  left: center.x - panel.width / 2,
  right: center.x + panel.width / 2,
  top: center.y - panel.height / 2,
  bottom: center.y + panel.height / 2
})

/**
 * Screen-space center for the terminal panel: tries above, below, right, left of the node's cube
 * (each clamped into the viewport) and takes the first that doesn't cover it. Falls back to the
 * clamped spot above when the viewport is too tight for any.
 */
export function placeTerminalPanel(
  cube: LabelRect,
  panel: PanelBox,
  viewport: PanelBox,
  margin: number,
  gap: number
): ScreenXY {
  const cx = (cube.left + cube.right) / 2
  const cy = (cube.top + cube.bottom) / 2
  const candidates: ScreenXY[] = [
    { x: cx, y: cube.top - gap - panel.height / 2 },
    { x: cx, y: cube.bottom + gap + panel.height / 2 },
    { x: cube.right + gap + panel.width / 2, y: cy },
    { x: cube.left - gap - panel.width / 2, y: cy }
  ]
  const clamped = candidates.map((c) => clampPanelToViewport(c, panel, viewport, margin))
  return clamped.find((c) => !intersects(rectAround(c, panel), cube)) ?? clamped[0]!
}
