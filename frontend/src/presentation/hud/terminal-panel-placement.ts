import type { LabelRect } from './label-collision-model'
import type { PanelBox, ScreenXY } from './terminal-panel-viewport-clamp'
import { clampPanelToViewport } from './terminal-panel-viewport-clamp'

const rectAround = (center: ScreenXY, panel: PanelBox): LabelRect => ({
  left: center.x - panel.width / 2,
  right: center.x + panel.width / 2,
  top: center.y - panel.height / 2,
  bottom: center.y + panel.height / 2
})

const overlapArea = (a: LabelRect, b: LabelRect): number =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))

/** Covering a HUD panel hides controls the user needs, so it costs more than covering the cube. */
const OBSTACLE_WEIGHT = 4

/**
 * Screen-space center for the terminal panel: tries above, below, right, left of the node's cube
 * (each clamped into the viewport) and takes the first that covers neither the cube nor a HUD
 * obstacle. When the viewport is too tight for any side, it docks to a screen edge/corner and
 * takes the spot that hides the least (HUD panels weighed above the cube).
 */
export function placeTerminalPanel(
  cube: LabelRect,
  panel: PanelBox,
  viewport: PanelBox,
  margin: number,
  gap: number,
  obstacles: readonly LabelRect[] = []
): ScreenXY {
  const cx = (cube.left + cube.right) / 2
  const cy = (cube.top + cube.bottom) / 2
  const sides: ScreenXY[] = [
    { x: cx, y: cube.top - gap - panel.height / 2 },
    { x: cx, y: cube.bottom + gap + panel.height / 2 },
    { x: cube.right + gap + panel.width / 2, y: cy },
    { x: cube.left - gap - panel.width / 2, y: cy }
  ]
  const near = { x: 0, y: 0 }
  const far = { x: viewport.width, y: viewport.height }
  const docks: ScreenXY[] = [
    { x: far.x, y: far.y },
    { x: near.x, y: far.y },
    { x: far.x, y: near.y },
    { x: near.x, y: near.y },
    { x: far.x, y: cy },
    { x: near.x, y: cy },
    { x: cx, y: far.y },
    { x: cx, y: near.y }
  ]
  const cost = (c: ScreenXY): number => {
    const rect = rectAround(c, panel)
    const hidden = obstacles.reduce((sum, o) => sum + overlapArea(rect, o), 0)
    return hidden * OBSTACLE_WEIGHT + overlapArea(rect, cube)
  }
  const clamp = (c: ScreenXY): ScreenXY => clampPanelToViewport(c, panel, viewport, margin)
  const clampedSides = sides.map(clamp)
  const clear = clampedSides.find((c) => cost(c) === 0)
  if (clear) return clear
  const candidates = [...clampedSides, ...docks.map(clamp)]
  return candidates.reduce((best, c) => (cost(c) < cost(best) ? c : best))
}
