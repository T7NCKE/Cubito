import { describe, expect, it } from 'vitest'
import { placeTerminalPanel } from './terminal-panel-placement'

const VIEWPORT = { width: 1200, height: 800 }
const PANEL = { width: 520, height: 360 }
const MARGIN = 12
const GAP = 8
const cube = { left: 580, top: 480, right: 620, bottom: 520 }

const rectOf = (center: { x: number; y: number }) => ({
  left: center.x - PANEL.width / 2,
  right: center.x + PANEL.width / 2,
  top: center.y - PANEL.height / 2,
  bottom: center.y + PANEL.height / 2
})

const overlaps = (
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number }
): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

describe('placeTerminalPanel', () => {
  it('sits above the cube, bottom edge one gap over its top', () => {
    const center = placeTerminalPanel(cube, PANEL, VIEWPORT, MARGIN, GAP)
    expect(center).toEqual({ x: 600, y: cube.top - GAP - PANEL.height / 2 })
  })

  it('moves below the cube when there is no room above', () => {
    const high = { left: 580, top: 100, right: 620, bottom: 140 }
    const center = placeTerminalPanel(high, PANEL, VIEWPORT, MARGIN, GAP)
    expect(overlaps(rectOf(center), high)).toBe(false)
    expect(center.y).toBeGreaterThan(140)
  })

  it('goes beside the cube when neither above nor below fits', () => {
    const middle = { left: 280, top: 190, right: 320, bottom: 230 }
    const tight = { width: 1200, height: 420 }
    const center = placeTerminalPanel(middle, PANEL, tight, MARGIN, GAP)
    expect(overlaps(rectOf(center), middle)).toBe(false)
    expect(center.x).toBeGreaterThan(320)
  })

  it('keeps the panel inside the viewport horizontally near an edge', () => {
    const left = { left: 20, top: 480, right: 60, bottom: 520 }
    const center = placeTerminalPanel(left, PANEL, VIEWPORT, MARGIN, GAP)
    expect(rectOf(center).left).toBeGreaterThanOrEqual(MARGIN)
  })

  it('falls back to the clamped spot above when no side is clear', () => {
    const tiny = { width: 560, height: 380 }
    const center = placeTerminalPanel(
      { left: 260, top: 180, right: 300, bottom: 200 },
      PANEL,
      tiny,
      MARGIN,
      GAP
    )
    expect(center.x).toBeGreaterThanOrEqual(PANEL.width / 2 + MARGIN)
  })
})
