import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { CAMERA_HEIGHT_PRESETS } from '../theme/scene-metrics'
import {
  LABEL_CHAR_ADVANCE_PX,
  LABEL_LINE_HEIGHT_PX,
  LABEL_OFFSET_Y_PX,
  LABEL_DROP_MAX_FACTOR,
  labelBoxPx,
  labelDropPx,
  labelRectAt,
  projectedCubeRect,
  resolveLabelCollisions
} from './label-collision-model'
import type {
  LabelCandidate,
  LabelObstacle,
  LabelRect,
  ScreenAnchor
} from './label-collision-model'
import type { NodeLabelModel } from './node-label-model'

const model = (overrides: Partial<NodeLabelModel> = {}): NodeLabelModel => ({
  primary: { text: 'feature-x', tone: 'primary' },
  secondary: null,
  callout: null,
  visible: true,
  ...overrides
})

describe('labelBoxPx', () => {
  it('is one line tall for primary only', () => {
    const box = labelBoxPx(model())
    expect(box.height).toBe(LABEL_LINE_HEIGHT_PX)
    expect(box.width).toBe('feature-x'.length * LABEL_CHAR_ADVANCE_PX)
  })

  it('is two lines tall with a secondary', () => {
    const box = labelBoxPx(model({ secondary: { text: 'agente · trabajando', tone: 'info' } }))
    expect(box.height).toBe(2 * LABEL_LINE_HEIGHT_PX)
  })

  it('is four lines tall with a callout (primary + secondary + 2 callout lines)', () => {
    const box = labelBoxPx(
      model({
        secondary: { text: 'agente · esperando input', tone: 'amber' },
        callout: {
          title: { text: 'esperando input', tone: 'amber' },
          hint: { text: 'revisá el agente para continuar', tone: 'amberDim' }
        }
      })
    )
    expect(box.height).toBe(4 * LABEL_LINE_HEIGHT_PX)
  })

  it('width tracks the LONGEST line, not the primary', () => {
    const box = labelBoxPx(
      model({
        callout: {
          title: { text: 'x', tone: 'amber' },
          hint: { text: 'revisá el agente para continuar', tone: 'amberDim' }
        }
      })
    )
    expect(box.width).toBe('revisá el agente para continuar'.length * LABEL_CHAR_ADVANCE_PX)
  })
})

describe('labelRectAt', () => {
  it('is centred on the anchor and dropped LABEL_OFFSET_Y_PX below it', () => {
    const rect = labelRectAt({ x: 100, y: 50, visible: true }, { width: 40, height: 20 })
    expect(rect.left).toBe(80)
    expect(rect.right).toBe(120)
    expect(rect.top).toBe(50 + LABEL_OFFSET_Y_PX)
    expect(rect.bottom).toBe(50 + LABEL_OFFSET_Y_PX + 20)
  })
})

describe('labelRectAt with a scaled drop', () => {
  it('uses the given drop for the top edge', () => {
    const rect = labelRectAt({ x: 0, y: 10, visible: true }, { width: 40, height: 20 }, 52)
    expect(rect.top).toBe(62)
    expect(rect.bottom).toBe(82)
  })
})

/** Independent oracle: project the isla look-at with a real three camera and measure 1 world-up unit. */
const labelDropReference = (viewport: number): number => {
  const { position, lookAt, fov } = CAMERA_HEIGHT_PRESETS.isla
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 1000)
  camera.position.set(position.x, position.y, position.z)
  camera.lookAt(lookAt.x, lookAt.y, lookAt.z)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  const lowY = new THREE.Vector3(lookAt.x, 0, lookAt.z).project(camera).y
  const highY = new THREE.Vector3(lookAt.x, 1, lookAt.z).project(camera).y
  return Math.abs(highY - lowY) * (viewport / 2)
}

describe('labelDropPx', () => {
  // Isla look-at scale for a 900px viewport, derived from the isla preset (see model constant).
  const islaScale = (viewport: number): number => labelDropReference(viewport)

  it('is within half a pixel of LABEL_OFFSET_Y_PX at the isla calibration scale', () => {
    expect(labelDropPx(islaScale(900), 900)).toBeCloseTo(LABEL_OFFSET_Y_PX, 0)
  })

  it('never shrinks below LABEL_OFFSET_Y_PX when the camera is farther away (general)', () => {
    expect(labelDropPx(islaScale(900) * 0.3, 900)).toBe(LABEL_OFFSET_Y_PX)
  })

  it('grows in proportion to how much closer the camera is (compare)', () => {
    expect(labelDropPx(islaScale(900) * 2, 900)).toBeCloseTo(LABEL_OFFSET_Y_PX * 2, -1)
  })

  it('is clamped to LABEL_DROP_MAX_FACTOR times the base drop', () => {
    expect(labelDropPx(islaScale(900) * 50, 900)).toBe(LABEL_OFFSET_Y_PX * LABEL_DROP_MAX_FACTOR)
  })

  it('falls back to the base drop for a degenerate projection', () => {
    expect(labelDropPx(0, 900)).toBe(LABEL_OFFSET_Y_PX)
    expect(labelDropPx(Number.NaN, 900)).toBe(LABEL_OFFSET_Y_PX)
    expect(labelDropPx(100, 0)).toBe(LABEL_OFFSET_Y_PX)
  })
})

const rect = (left: number, right: number): LabelRect => ({ left, top: 0, right, bottom: 10 })

const candidate = (id: string, priority: number, left: number, right: number): LabelCandidate => ({
  id,
  priority,
  rect: rect(left, right)
})

describe('resolveLabelCollisions', () => {
  it('hides nothing when boxes are disjoint', () => {
    const result = resolveLabelCollisions(
      [candidate('a', 1, 0, 100), candidate('b', 0, 200, 300)],
      new Set()
    )
    expect(result.size).toBe(0)
  })

  it('hides the lower-priority label of an overlapping pair', () => {
    const result = resolveLabelCollisions(
      [candidate('a', 1, 0, 100), candidate('b', 0, 50, 150)],
      new Set()
    )
    expect(result.has('b')).toBe(true)
    expect(result.has('a')).toBe(false)
  })

  it('a 3-way chain hides both losers, never the top-priority candidate', () => {
    // b (priority 2, the winner) overlaps both a and c; a and c do not overlap each other.
    const result = resolveLabelCollisions(
      [candidate('a', 1, 0, 100), candidate('b', 2, 80, 180), candidate('c', 0, 160, 260)],
      new Set()
    )
    expect(result.has('a')).toBe(true)
    expect(result.has('c')).toBe(true)
    expect(result.has('b')).toBe(false)
  })

  it('breaks a priority tie by id, not by array order', () => {
    const shuffledOrders = [
      [candidate('x', 1, 50, 150), candidate('y', 1, 0, 100)],
      [candidate('y', 1, 0, 100), candidate('x', 1, 50, 150)]
    ]
    for (const candidates of shuffledOrders) {
      const result = resolveLabelCollisions(candidates, new Set())
      expect(result.has('y')).toBe(true) // 'x' < 'y' lexicographically, so x wins
      expect(result.has('x')).toBe(false)
    }
  })

  it('the top-priority candidate is never hidden', () => {
    const result = resolveLabelCollisions(
      [candidate('top', 5, 0, 100), candidate('a', 1, 10, 90), candidate('b', 0, 20, 80)],
      new Set()
    )
    expect(result.has('top')).toBe(false)
  })

  it('hysteresis: a hidden label 3px clear of the winner stays hidden', () => {
    const result = resolveLabelCollisions(
      [candidate('top', 1, 0, 100), candidate('loser', 0, 103, 203)],
      new Set(['loser'])
    )
    expect(result.has('loser')).toBe(true)
  })

  it('hysteresis: a visible label overlapped by 3px stays visible', () => {
    const result = resolveLabelCollisions(
      [candidate('top', 1, 0, 100), candidate('other', 0, 97, 197)],
      new Set()
    )
    expect(result.has('other')).toBe(false)
  })

  it('hysteresis: a visible label overlapped by 6px is hidden', () => {
    const result = resolveLabelCollisions(
      [candidate('top', 1, 0, 100), candidate('other', 0, 94, 194)],
      new Set()
    )
    expect(result.has('other')).toBe(true)
  })
})

describe('resolveLabelCollisions obstacles (other nodes cubes)', () => {
  const obstacle = (id: string, left: number, right: number): LabelObstacle => ({
    id,
    rect: rect(left, right)
  })

  it('hides a label that overlaps another node cube, even when it is the only label', () => {
    const result = resolveLabelCollisions([candidate('a', 1, 0, 100)], new Set(), [
      obstacle('b', 50, 150)
    ])
    expect(result.has('a')).toBe(true)
  })

  it('ignores the label own cube', () => {
    const result = resolveLabelCollisions([candidate('a', 1, 0, 100)], new Set(), [
      obstacle('a', 0, 100)
    ])
    expect(result.size).toBe(0)
  })

  it('a cube never hides another label by itself being a cube (disjoint stays visible)', () => {
    const result = resolveLabelCollisions([candidate('a', 1, 0, 100)], new Set(), [
      obstacle('b', 200, 300)
    ])
    expect(result.size).toBe(0)
  })

  it('priority does not rescue a label from a cube', () => {
    const result = resolveLabelCollisions(
      [candidate('top', 9, 0, 100), candidate('low', 0, 300, 400)],
      new Set(),
      [obstacle('x', 20, 80)]
    )
    expect(result.has('top')).toBe(true)
    expect(result.has('low')).toBe(false)
  })

  it('hysteresis: a visible label overlapping a cube by 3px stays, a hidden one 3px clear stays hidden', () => {
    expect(
      resolveLabelCollisions([candidate('a', 1, 0, 100)], new Set(), [obstacle('b', 97, 197)]).size
    ).toBe(0)
    expect(
      resolveLabelCollisions([candidate('a', 1, 0, 100)], new Set(['a']), [obstacle('b', 103, 203)])
        .size
    ).toBe(1)
  })
})

const at = (x: number, y: number, visible = true): ScreenAnchor => ({ x, y, visible })

describe('projectedCubeRect', () => {
  it('bounds the projected corners and grows by the margin', () => {
    expect(projectedCubeRect([at(10, 20), at(30, 5), at(20, 40)], 2)).toEqual({
      left: 8,
      top: 3,
      right: 32,
      bottom: 42
    })
  })

  it('is null when any corner is not visible (behind the camera)', () => {
    expect(projectedCubeRect([at(10, 20), at(30, 5, false)], 2)).toBeNull()
  })
})
