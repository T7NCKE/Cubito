import { describe, expect, it } from 'vitest'
import {
  CAMERA_FAR,
  CAMERA_HEIGHT_PRESETS,
  CAMERA_NEAR,
  ELEVATION,
  FIT_MIN_RADIUS,
  FLOW_PERIOD_SECONDS,
  MAX_DOLLY_DISTANCE,
  MIN_DOLLY_DISTANCE,
  NODE_HEIGHT,
  ORBIT_DAMPING,
  NODE_SIZE,
  PICK_DRAG_SLOP_PX,
  ROOT_MIN_ELEVATION,
  SHADOW_Y
} from './scene-metrics'

describe('scene-metrics', () => {
  it('pins the elevation ladder to the design table', () => {
    expect(ELEVATION['waiting-input']).toBe(0.6)
    expect(ELEVATION.working).toBe(0.52)
    expect(ELEVATION.dirty).toBe(0.44)
    expect(ELEVATION.unread).toBe(0.44)
    expect(ELEVATION.spawning).toBe(0.3)
    expect(ELEVATION.idle).toBe(0.2)
    expect(ELEVATION.archived).toBe(0)
  })

  it('pins the node body constants', () => {
    expect(NODE_SIZE).toBe(1)
    expect(NODE_HEIGHT).toBeCloseTo(0.9127, 10)
  })

  it('pins the root elevation floor', () => {
    expect(ROOT_MIN_ELEVATION).toBe(0.48)
  })

  it('pins the shadow ground offset', () => {
    expect(SHADOW_Y).toBe(0.005)
  })

  it('pins the flow animation period', () => {
    expect(FLOW_PERIOD_SECONDS).toBe(1.2)
  })

  it('exposes camera constants', () => {
    expect(FIT_MIN_RADIUS).toBe(6)
    expect(ORBIT_DAMPING).toBe(0.08)
  })

  it('pins the perspective rig constants', () => {
    expect(CAMERA_NEAR).toBe(0.1)
    expect(CAMERA_FAR).toBe(400)
    expect(MIN_DOLLY_DISTANCE).toBe(4)
    expect(MAX_DOLLY_DISTANCE).toBe(320)
    expect(PICK_DRAG_SLOP_PX).toBe(4)
  })

  it('pins the four camera height presets', () => {
    expect(CAMERA_HEIGHT_PRESETS.general).toEqual({
      position: { x: 19, y: 58, z: 82 },
      lookAt: { x: 0, y: 0, z: 0 },
      fov: 40,
      durationMs: 600
    })
    expect(CAMERA_HEIGHT_PRESETS.isla).toEqual({
      position: { x: 12, y: 15, z: 24 },
      lookAt: { x: -0.5, y: 0, z: -1.5 },
      fov: 38,
      durationMs: 420
    })
    expect(CAMERA_HEIGHT_PRESETS.foco).toEqual({
      position: { x: 3.4, y: 2.6, z: 4.6 },
      lookAt: { x: 0, y: 0.7, z: 0 },
      fov: 34,
      durationMs: 420
    })
    expect(CAMERA_HEIGHT_PRESETS.comparar).toEqual({
      position: { x: 0, y: 5.5, z: 15 },
      lookAt: { x: 0, y: 0.8, z: -8 },
      fov: 44,
      durationMs: 600
    })
  })
})
