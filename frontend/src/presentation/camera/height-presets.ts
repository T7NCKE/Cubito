import type { CameraFraming, Vec3 } from './camera-framing'
import type { CameraHeight, CameraPose } from './camera-pose'
import {
  CAMERA_HEIGHT_PRESETS,
  MAX_DOLLY_DISTANCE,
  MIN_DOLLY_DISTANCE
} from '../theme/scene-metrics'

const DEG_TO_RAD = Math.PI / 180

export type HeightPreset = { position: Vec3; lookAt: Vec3; fov: number; durationMs: number }

/** Typed re-binding: exhaustiveness without scene-metrics importing camera/ (design C4). */
const PRESETS: Record<CameraHeight, HeightPreset> = CAMERA_HEIGHT_PRESETS

export const heightDurationMs = (height: CameraHeight): number => PRESETS[height].durationMs
/** A preset's vertical fov — so COMPARAR_FOV is never a literal 44 outside this table. */
export const heightFov = (height: CameraHeight): number => PRESETS[height].fov

const toGround = (point: Vec3): Vec3 => ({ x: point.x, y: 0, z: point.z })
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const normalize = (v: Vec3): Vec3 => {
  const length = Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2)
  return { x: v.x / length, y: v.y / length, z: v.z / length }
}
/** Viewing direction of a preset, derived from itself so a retune stays self-consistent. */
const viewDirectionOf = (preset: HeightPreset): Vec3 =>
  normalize(sub(preset.position, preset.lookAt))

/** foco uses `selection ?? anchor` (D6) — a working/waiting elevation bump must not move the
 *  camera, so the anchor's y is always forced to 0 before the preset offset is added. */
export const poseForHeight = (
  height: CameraHeight,
  anchor: Vec3,
  selection: Vec3 | null
): CameraPose => {
  const preset = PRESETS[height]
  const base = toGround(height === 'foco' ? (selection ?? anchor) : anchor)
  return { position: add(base, preset.position), lookAt: add(base, preset.lookAt), fov: preset.fov }
}

/** Viewing direction shared by every extent-derived pose (design D3): derived from the isla
 *  preset itself, so a retune of isla stays self-consistent. */
export const ISLA_VIEW_DIRECTION: Vec3 = viewDirectionOf(PRESETS.isla)
/** normalize(position − lookAt) = (0, 0.2001, 0.9798), polar 78.45° (design C6/D2) — the
 *  comparar preset's OWN direction, kept unchanged while its distance becomes extent-derived. */
export const COMPARAR_VIEW_DIRECTION: Vec3 = viewDirectionOf(PRESETS.comparar)

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** `aspect` < 1 makes the HORIZONTAL field the binding one, so fitting on the vertical fov
 *  alone under-fits a narrowed canvas (design C7). `aspect = 1` reproduces today's math
 *  exactly, so the three existing call sites are untouched. */
export const poseForExtent = (
  framing: CameraFraming,
  fov: number,
  aspect = 1,
  direction: Vec3 = ISLA_VIEW_DIRECTION,
  maxDistance = MAX_DOLLY_DISTANCE
): CameraPose => {
  const halfV = (fov / 2) * DEG_TO_RAD
  const half = aspect >= 1 ? halfV : Math.atan(Math.tan(halfV) * aspect)
  const distance = clamp(framing.radius / Math.sin(half), MIN_DOLLY_DISTANCE, maxDistance)
  return {
    position: {
      x: framing.target.x + distance * direction.x,
      y: framing.target.y + distance * direction.y,
      z: framing.target.z + distance * direction.z
    },
    lookAt: framing.target,
    fov
  }
}

const GENERAL_VIEW_DIRECTION: Vec3 = viewDirectionOf(PRESETS.general)
const GENERAL_DISTANCE = Math.hypot(
  PRESETS.general.position.x - PRESETS.general.lookAt.x,
  PRESETS.general.position.y - PRESETS.general.lookAt.y,
  PRESETS.general.position.z - PRESETS.general.lookAt.z
)

/** Overview ('v'): the fixed preset while the galaxy fits it, else pulled back along the same
 *  direction until every island is inside the frustum at the live aspect. */
export const poseForGeneral = (framing: CameraFraming, aspect: number): CameraPose => {
  const ground = toGround(framing.target)
  const fixed = poseForHeight('general', ground, null)
  const fitted = poseForExtent(
    { target: ground, radius: framing.radius },
    PRESETS.general.fov,
    aspect,
    GENERAL_VIEW_DIRECTION,
    MAX_DOLLY_DISTANCE
  )
  const fittedDistance = Math.hypot(
    fitted.position.x - ground.x,
    fitted.position.y - ground.y,
    fitted.position.z - ground.z
  )
  return fittedDistance > GENERAL_DISTANCE ? fitted : fixed
}
