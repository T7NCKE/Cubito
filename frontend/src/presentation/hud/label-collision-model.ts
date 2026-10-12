import { CAMERA_HEIGHT_PRESETS } from '../theme/scene-metrics'
import type { NodeLabelModel } from './node-label-model'

/** Mockup drop below the ground shadow (index.html node-label offset, design D1). */
export const LABEL_OFFSET_Y_PX = 26
/** Closest the drop may scale up to: bounds the label's distance from a very tightly framed node. */
export const LABEL_DROP_MAX_FACTOR = 2.5
/** Glow slack around a projected cube before another node's label counts as touching it. */
export const CUBE_OBSTACLE_MARGIN_PX = 3
/** Monospace advance for 'Fira Code'/SF Mono/Cascadia at 11px (index.html font-size). */
export const LABEL_CHAR_ADVANCE_PX = 6.6
/** 11px × 1.45 line-height (index.html .cubito-node-label). */
export const LABEL_LINE_HEIGHT_PX = 15.95
/** Dead band, both directions — kills flicker at a collision boundary with no timers. */
export const LABEL_COLLISION_HYSTERESIS_PX = 4

const ISLA_PRESET = CAMERA_HEIGHT_PRESETS.isla
const ISLA_OFFSET = {
  x: ISLA_PRESET.position.x - ISLA_PRESET.lookAt.x,
  y: ISLA_PRESET.position.y - ISLA_PRESET.lookAt.y,
  z: ISLA_PRESET.position.z - ISLA_PRESET.lookAt.z
}
const ISLA_DISTANCE = Math.hypot(ISLA_OFFSET.x, ISLA_OFFSET.y, ISLA_OFFSET.z)
/** Screen px of one world-up unit at the isla look-at, per viewport-height px: the scale the
 *  26px drop was calibrated at. cos(pitch) is the foreshortening of the vertical axis. */
const ISLA_PX_PER_UNIT_PER_VIEWPORT_PX =
  Math.hypot(ISLA_OFFSET.x, ISLA_OFFSET.z) /
  ISLA_DISTANCE /
  (2 * ISLA_DISTANCE * Math.tan((ISLA_PRESET.fov * Math.PI) / 360))

/** Drop below the anchor, grown by how much closer than the isla calibration the camera is, so a
 *  tight compare framing keeps the label clear of the (larger) cube. Never below the isla/general drop. */
export function labelDropPx(pxPerUnit: number, viewportHeightPx: number): number {
  const reference = ISLA_PX_PER_UNIT_PER_VIEWPORT_PX * viewportHeightPx
  if (!(reference > 0) || !(pxPerUnit > 0)) return LABEL_OFFSET_Y_PX
  const factor = Math.min(LABEL_DROP_MAX_FACTOR, Math.max(1, pxPerUnit / reference))
  return LABEL_OFFSET_Y_PX * factor
}

export type LabelBox = { readonly width: number; readonly height: number }
export type LabelRect = {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}
export type ScreenAnchor = { readonly x: number; readonly y: number; readonly visible: boolean }
/** Declared here, not imported from terminal-connector-projector — scene/ may not import that module. */
export type LabelAnchorProjection = (ground: {
  readonly x: number
  readonly y: number
  readonly z: number
}) => ScreenAnchor

export type LabelCandidate = {
  readonly id: string
  readonly rect: LabelRect
  readonly priority: number
}

/** A node's projected cube: labels of OTHER nodes must clear it; `id` is its own node. */
export type LabelObstacle = { readonly id: string; readonly rect: LabelRect }

/** Screen bounds of a cube's projected corners, grown by `margin` for the glow; null if any corner is off-camera. */
export function projectedCubeRect(
  corners: readonly ScreenAnchor[],
  margin: number
): LabelRect | null {
  if (corners.length === 0 || corners.some((corner) => !corner.visible)) return null
  return {
    left: Math.min(...corners.map((c) => c.x)) - margin,
    top: Math.min(...corners.map((c) => c.y)) - margin,
    right: Math.max(...corners.map((c) => c.x)) + margin,
    bottom: Math.max(...corners.map((c) => c.y)) + margin
  }
}

const linesOf = (model: NodeLabelModel): readonly string[] => {
  const lines = [model.primary.text]
  if (model.secondary !== null) lines.push(model.secondary.text)
  if (model.callout !== null) lines.push(model.callout.title.text, model.callout.hint.text)
  return lines
}

/** Box from the text alone — monospace, so no getBoundingClientRect and no forced reflow. */
export function labelBoxPx(model: NodeLabelModel): LabelBox {
  const lines = linesOf(model)
  const widestChars = Math.max(...lines.map((line) => line.length))
  return {
    width: widestChars * LABEL_CHAR_ADVANCE_PX,
    height: lines.length * LABEL_LINE_HEIGHT_PX
  }
}

/** Centred on the projected ground point, dropped `dropPx` below it (see labelDropPx). */
export function labelRectAt(
  anchor: ScreenAnchor,
  box: LabelBox,
  dropPx: number = LABEL_OFFSET_Y_PX
): LabelRect {
  const left = anchor.x - box.width / 2
  const top = anchor.y + dropPx
  return { left, top, right: left + box.width, bottom: top + box.height }
}

const pad = (rect: LabelRect, amount: number): LabelRect => ({
  left: rect.left - amount,
  top: rect.top - amount,
  right: rect.right + amount,
  bottom: rect.bottom + amount
})

const intersects = (a: LabelRect, b: LabelRect): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

const byPriorityThenId = (a: LabelCandidate, b: LabelCandidate): number =>
  b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Greedy priority hiding (design D3). Stable order — priority desc, then id asc — so the
 * result never depends on Map insertion order, which reconciliation can reorder frame to frame.
 * Hysteresis is asymmetric per candidate: a currently-hidden one is padded OUT (needs real
 * clearance to return), a currently-visible one is padded IN (needs real overlap to vanish).
 * `obstacles` (other nodes' cubes) hide any label they touch, whatever its priority, and never
 * join the accepted set — they are not labels.
 */
export function resolveLabelCollisions(
  candidates: readonly LabelCandidate[],
  hidden: ReadonlySet<string>,
  obstacles: readonly LabelObstacle[] = []
): Set<string> {
  const accepted: LabelRect[] = []
  const nextHidden = new Set<string>()
  for (const candidate of [...candidates].sort(byPriorityThenId)) {
    const amount = hidden.has(candidate.id)
      ? LABEL_COLLISION_HYSTERESIS_PX
      : -LABEL_COLLISION_HYSTERESIS_PX
    const padded = pad(candidate.rect, amount)
    const blockedByCube = obstacles.some(
      (obstacle) => obstacle.id !== candidate.id && intersects(padded, obstacle.rect)
    )
    if (blockedByCube || accepted.some((rect) => intersects(padded, rect))) {
      nextHidden.add(candidate.id)
    } else {
      accepted.push(candidate.rect)
    }
  }
  return nextHidden
}
