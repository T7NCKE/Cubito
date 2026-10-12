import { describe, expect, it } from 'vitest'
import {
  COMPARAR_VIEW_DIRECTION,
  ISLA_VIEW_DIRECTION,
  heightDurationMs,
  heightFov,
  poseForExtent,
  poseForGeneral,
  poseForHeight
} from './height-presets'
import { CAMERA_HEIGHTS } from './camera-pose'
import type { CameraPose } from './camera-pose'
import {
  CAMERA_HEIGHT_PRESETS,
  MAX_DOLLY_DISTANCE,
  MIN_DOLLY_DISTANCE,
  MAX_POLAR_DEG,
  MIN_POLAR_DEG
} from '../theme/scene-metrics'
import { frameAll } from './camera-framing'
import type { Vec3 } from './camera-framing'

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 }

const vecLength = (v: Vec3): number => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
})
const normalize = (v: Vec3): Vec3 => {
  const length = vecLength(v)
  return { x: v.x / length, y: v.y / length, z: v.z / length }
}

/** Does `pose` (at the given aspect) keep `point` inside its view frustum? Mirrors design C6's
 *  own derivation: r/u/d from the pose, then the standard tan(halfH) = tan(halfV) * aspect
 *  relation (independent of the >=1 branch poseForExtent takes to pick its FIT distance). */
const framesPoint = (pose: CameraPose, aspect: number, point: Vec3): boolean => {
  const dir = normalize(sub(pose.lookAt, pose.position))
  const right = normalize(cross(dir, { x: 0, y: 1, z: 0 }))
  const up = cross(right, dir)
  const v = sub(point, pose.position)
  const forward = dot(v, dir)
  if (forward <= 0) return false
  const halfV = (pose.fov / 2) * (Math.PI / 180)
  const halfH = Math.atan(Math.tan(halfV) * aspect)
  return (
    Math.abs(dot(v, right)) <= forward * Math.tan(halfH) &&
    Math.abs(dot(v, up)) <= forward * Math.tan(halfV)
  )
}

describe('poseForHeight', () => {
  it('offsets position and lookAt from the anchor ground point for general', () => {
    const anchor: Vec3 = { x: 10, y: 7, z: -4 }
    const pose = poseForHeight('general', anchor, null)
    expect(pose.position).toEqual({ x: 10 + 19, y: 58, z: -4 + 82 })
    expect(pose.lookAt).toEqual({ x: 10, y: 0, z: -4 })
    expect(pose.fov).toBe(40)
  })

  it('anchors isla and comparar on the island ground point', () => {
    const anchor: Vec3 = { x: 10, y: 7, z: -4 }
    const isla = poseForHeight('isla', anchor, null)
    expect(isla.position).toEqual({ x: 10 + 12, y: 15, z: -4 + 24 })
    expect(isla.lookAt).toEqual({ x: 10 - 0.5, y: 0, z: -4 - 1.5 })

    const comparar = poseForHeight('comparar', anchor, null)
    expect(comparar.position).toEqual({ x: 10, y: 5.5, z: -4 + 15 })
    expect(comparar.lookAt).toEqual({ x: 10, y: 0.8, z: -4 - 8 })
  })

  it('anchors foco on the selection with its lookAt lifted to the foco eye height', () => {
    const anchor: Vec3 = { x: 10, y: 7, z: -4 }
    const selection: Vec3 = { x: -2, y: 3, z: 6 }
    const pose = poseForHeight('foco', anchor, selection)
    expect(pose.position).toEqual({ x: -2 + 3.4, y: 2.6, z: 6 + 4.6 })
    expect(pose.lookAt).toEqual({ x: -2, y: 0.7, z: 6 })
  })

  it('falls back to the anchor when nothing is selected for foco', () => {
    const anchor: Vec3 = { x: 1, y: 0, z: 2 }
    const pose = poseForHeight('foco', anchor, null)
    expect(pose.position).toEqual({ x: 1 + 3.4, y: 2.6, z: 2 + 4.6 })
    expect(pose.lookAt).toEqual({ x: 1, y: 0.7, z: 2 })
  })

  it('ignores the anchor y, using only x and z', () => {
    const flat = poseForHeight('general', { x: 5, y: 0, z: 5 }, null)
    const elevated = poseForHeight('general', { x: 5, y: 99, z: 5 }, null)
    expect(elevated).toEqual(flat)
  })
})

describe('heightDurationMs', () => {
  it('is 600 for general and comparar, 420 for isla and foco', () => {
    expect(heightDurationMs('general')).toBe(600)
    expect(heightDurationMs('comparar')).toBe(600)
    expect(heightDurationMs('isla')).toBe(420)
    expect(heightDurationMs('foco')).toBe(420)
  })
})

describe('OrbitControls bounds ratchet', () => {
  it('every preset sits inside the OrbitControls polar and dolly bounds', () => {
    for (const height of CAMERA_HEIGHTS) {
      const selection = height === 'foco' ? ORIGIN : null
      const pose = poseForHeight(height, ORIGIN, selection)
      const offset = sub(pose.position, pose.lookAt)
      const distance = vecLength(offset)
      const polarDeg = (Math.acos(offset.y / distance) * 180) / Math.PI

      expect(distance).toBeGreaterThanOrEqual(MIN_DOLLY_DISTANCE)
      expect(distance).toBeLessThanOrEqual(MAX_DOLLY_DISTANCE)
      expect(polarDeg).toBeGreaterThanOrEqual(MIN_POLAR_DEG)
      expect(polarDeg).toBeLessThanOrEqual(MAX_POLAR_DEG)
    }
  })
})

describe('poseForGeneral', () => {
  it('keeps the fixed overview preset when the galaxy already fits it', () => {
    const framing = { target: { x: 10, y: 0.5, z: -4 }, radius: 12 }
    expect(poseForGeneral(framing, 1.6)).toEqual(
      poseForHeight('general', { x: 10, y: 0, z: -4 }, null)
    )
  })

  it('pulls back along the preset direction until a wide galaxy fits both axes', () => {
    const wide = { target: { x: 0, y: 0, z: 0 }, radius: 140 }
    const aspect = 900 / 700
    const pose = poseForGeneral(wide, aspect)
    const fixed = poseForHeight('general', { x: 0, y: 0, z: 0 }, null)
    expect(vecLength(sub(pose.position, pose.lookAt))).toBeGreaterThan(
      vecLength(sub(fixed.position, fixed.lookAt))
    )
    expect(
      dot(normalize(sub(pose.position, pose.lookAt)), normalize(sub(fixed.position, fixed.lookAt)))
    ).toBeCloseTo(1, 6)
    for (const sign of [-1, 1]) {
      expect(framesPoint(pose, aspect, { x: sign * 140, y: 0, z: 0 })).toBe(true)
    }
  })
})

describe('poseForExtent', () => {
  it('places the camera at radius / sin(fov/2) from the framing target', () => {
    const framing = { target: { x: 1, y: 2, z: 3 }, radius: 10 }
    const fov = 40
    const pose = poseForExtent(framing, fov)
    const expectedDistance = 10 / Math.sin(((fov / 2) * Math.PI) / 180)
    expect(vecLength(sub(pose.position, pose.lookAt))).toBeCloseTo(expectedDistance, 6)
  })

  it('uses the isla viewing direction, derived from the isla preset itself', () => {
    const framing = { target: { x: 0, y: 0, z: 0 }, radius: 10 }
    const pose = poseForExtent(framing, 40)
    const offset = sub(pose.position, pose.lookAt)
    const length = vecLength(offset)
    const direction = { x: offset.x / length, y: offset.y / length, z: offset.z / length }
    expect(direction.x).toBeCloseTo(ISLA_VIEW_DIRECTION.x, 9)
    expect(direction.y).toBeCloseTo(ISLA_VIEW_DIRECTION.y, 9)
    expect(direction.z).toBeCloseTo(ISLA_VIEW_DIRECTION.z, 9)
  })

  it('clamps the distance into [MIN_DOLLY_DISTANCE, MAX_DOLLY_DISTANCE]', () => {
    const target = { x: 0, y: 0, z: 0 }
    const farTooBig = poseForExtent({ target, radius: 10000 }, 40)
    expect(vecLength(sub(farTooBig.position, target))).toBeCloseTo(MAX_DOLLY_DISTANCE, 6)

    const tooSmall = poseForExtent({ target, radius: 0.001 }, 40)
    expect(vecLength(sub(tooSmall.position, target))).toBeCloseTo(MIN_DOLLY_DISTANCE, 6)
  })

  it('keeps lookAt at the framing target and fov as given', () => {
    const framing = { target: { x: 4, y: -1, z: 2 }, radius: 8 }
    const pose = poseForExtent(framing, 36)
    expect(pose.lookAt).toEqual(framing.target)
    expect(pose.fov).toBe(36)
  })

  it('reproduces the vertical-fov fit when aspect is omitted (regression: three existing call sites)', () => {
    const framing = { target: { x: 2, y: -1, z: 4 }, radius: 12 }
    const withoutAspect = poseForExtent(framing, 38)
    const explicitAspect1 = poseForExtent(framing, 38, 1)
    expect(withoutAspect).toEqual(explicitAspect1)
  })

  it('pulls the camera back as the aspect narrows (0.75 > 1.0 >= 1.5, monotone)', () => {
    const framing = { target: { x: 0, y: 0, z: 0 }, radius: 10 }
    const d075 = vecLength(sub(poseForExtent(framing, 44, 0.75).position, framing.target))
    const d100 = vecLength(sub(poseForExtent(framing, 44, 1.0).position, framing.target))
    const d150 = vecLength(sub(poseForExtent(framing, 44, 1.5).position, framing.target))
    expect(d075).toBeGreaterThan(d100)
    expect(d100).toBeGreaterThanOrEqual(d150)
  })

  it('above aspect 1 keeps the vertical fit — the vertical field stays binding', () => {
    const framing = { target: { x: 0, y: 0, z: 0 }, radius: 10 }
    const at1 = poseForExtent(framing, 44, 1)
    const at15 = poseForExtent(framing, 44, 1.5)
    const at3 = poseForExtent(framing, 44, 3)
    expect(at15).toEqual(at1)
    expect(at3).toEqual(at1)
  })

  it('still clamps into [MIN_DOLLY_DISTANCE, MAX_DOLLY_DISTANCE] at an extreme aspect', () => {
    const target = { x: 0, y: 0, z: 0 }
    const tooFar = poseForExtent({ target, radius: 10000 }, 44, 0.3)
    expect(vecLength(sub(tooFar.position, target))).toBeCloseTo(MAX_DOLLY_DISTANCE, 6)
    const tooClose = poseForExtent({ target, radius: 0.001 }, 44, 0.3)
    expect(vecLength(sub(tooClose.position, target))).toBeCloseTo(MIN_DOLLY_DISTANCE, 6)
  })

  it('places the camera along an explicit direction when one is given', () => {
    const framing = { target: { x: 1, y: 2, z: 3 }, radius: 5 }
    const direction: Vec3 = { x: 0, y: 1, z: 0 }
    const pose = poseForExtent(framing, 40, 1, direction)
    expect(pose.position.x).toBeCloseTo(framing.target.x, 9)
    expect(pose.position.z).toBeCloseTo(framing.target.z, 9)
    expect(pose.position.y).toBeGreaterThan(framing.target.y)
  })
})

describe('COMPARAR_VIEW_DIRECTION', () => {
  it('is the normalized comparar preset offset and is a unit vector', () => {
    const offset = sub(
      CAMERA_HEIGHT_PRESETS.comparar.position,
      CAMERA_HEIGHT_PRESETS.comparar.lookAt
    )
    const length = vecLength(offset)
    expect(COMPARAR_VIEW_DIRECTION.x).toBeCloseTo(offset.x / length, 9)
    expect(COMPARAR_VIEW_DIRECTION.y).toBeCloseTo(offset.y / length, 9)
    expect(COMPARAR_VIEW_DIRECTION.z).toBeCloseTo(offset.z / length, 9)
    expect(vecLength(COMPARAR_VIEW_DIRECTION)).toBeCloseTo(1, 9)
  })

  it('stays inside [MIN_POLAR_DEG, MAX_POLAR_DEG] (78.45° vs 80° — the C8 ratchet, restated)', () => {
    const polarDeg = (Math.acos(COMPARAR_VIEW_DIRECTION.y) * 180) / Math.PI
    expect(polarDeg).toBeGreaterThanOrEqual(MIN_POLAR_DEG)
    expect(polarDeg).toBeLessThanOrEqual(MAX_POLAR_DEG)
  })
})

describe('heightFov', () => {
  it("returns each preset's fov", () => {
    for (const height of CAMERA_HEIGHTS) {
      expect(heightFov(height)).toBe(CAMERA_HEIGHT_PRESETS[height].fov)
    }
  })
})

describe('a 3-child root camada fits at aspect 0.72 (design C6 fixture)', () => {
  // C6's own worked positions for a 3-child root fan-out: A/B/C at 80°/180°/280° on the ring.
  const children: Vec3[] = [
    { x: 1.65, y: 0, z: 9.36 },
    { x: -9.5, y: 0, z: 0 },
    { x: 1.65, y: 0, z: -9.36 }
  ]
  const aspect = 0.72

  it('the extent-derived comparar pose frames every child', () => {
    const framing = frameAll(children)
    const pose = poseForExtent(framing, heightFov('comparar'), aspect, COMPARAR_VIEW_DIRECTION)
    for (const child of children) {
      expect(framesPoint(pose, aspect, child)).toBe(true)
    }
  })

  it('the OLD fixed comparar preset fails the same check — proof a fixed offset cannot frame a root camada', () => {
    const fixedPose: CameraPose = {
      position: CAMERA_HEIGHT_PRESETS.comparar.position,
      lookAt: CAMERA_HEIGHT_PRESETS.comparar.lookAt,
      fov: CAMERA_HEIGHT_PRESETS.comparar.fov
    }
    const allFramed = children.every((child) => framesPoint(fixedPose, aspect, child))
    expect(allFramed).toBe(false)
  })
})
