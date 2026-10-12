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

/** Natural panel size; keep in sync with `.cubito-terminal-panel` in index.html. */
export const TERMINAL_PANEL_FULL: PanelBox = { width: 520, height: 360 }
/** Smallest size worth typing in (about 48x10 cells at the default font). */
export const TERMINAL_PANEL_MIN: PanelBox = { width: 340, height: 220 }
const SHRINK_STEPS = 6

type Overlap = { cube: number; obstacles: number }

const overlapOf = (
  center: ScreenXY,
  size: PanelBox,
  cube: LabelRect,
  obstacles: readonly LabelRect[]
): Overlap => {
  const rect = rectAround(center, size)
  return {
    cube: overlapArea(rect, cube),
    obstacles: obstacles.reduce((sum, o) => sum + overlapArea(rect, o), 0)
  }
}

/**
 * Picks the largest panel size (full down to a usable minimum) that sits clear of the cube and
 * every HUD obstacle; failing that, the largest that at least clears the HUD, else the minimum.
 * At roomy viewports this is simply the full size.
 */
export function fitTerminalPanel(
  cube: LabelRect,
  viewport: PanelBox,
  margin: number,
  gap: number,
  obstacles: readonly LabelRect[] = []
): { size: PanelBox; center: ScreenXY } {
  const room = { width: viewport.width - 2 * margin, height: viewport.height - 2 * margin }
  const largest = {
    width: Math.min(TERMINAL_PANEL_FULL.width, room.width),
    height: Math.min(TERMINAL_PANEL_FULL.height, room.height)
  }
  const smallest = {
    width: Math.min(largest.width, TERMINAL_PANEL_MIN.width),
    height: Math.min(largest.height, TERMINAL_PANEL_MIN.height)
  }
  let hudClear: { size: PanelBox; center: ScreenXY } | null = null
  let last = { size: largest, center: { x: 0, y: 0 } }
  for (let step = 0; step <= SHRINK_STEPS; step++) {
    const t = step / SHRINK_STEPS
    const size = {
      width: Math.round(largest.width + (smallest.width - largest.width) * t),
      height: Math.round(largest.height + (smallest.height - largest.height) * t)
    }
    const center = placeTerminalPanel(cube, size, viewport, margin, gap, obstacles)
    last = { size, center }
    const overlap = overlapOf(center, size, cube, obstacles)
    if (overlap.obstacles === 0 && overlap.cube === 0) return last
    if (overlap.obstacles === 0) hudClear ??= last
  }
  return hudClear ?? last
}
