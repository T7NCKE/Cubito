import { describe, expect, it } from 'vitest'
import {
  fitTerminalPanel,
  placeTerminalPanel,
  TERMINAL_PANEL_FULL,
  TERMINAL_PANEL_MIN
} from './terminal-panel-placement'

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

  describe('with HUD obstacles', () => {
    const small = { width: 900, height: 700 }
    const mid = { left: 430, top: 330, right: 470, bottom: 370 }
    const fanOutPanel = { left: 16, right: 436, top: 12, bottom: 300 }

    it('avoids the obstacle when a side that clears the cube would sit under it', () => {
      const center = placeTerminalPanel(mid, PANEL, small, MARGIN, GAP, [fanOutPanel])
      expect(overlaps(rectOf(center), fanOutPanel)).toBe(false)
      expect(rectOf(center).left).toBeGreaterThanOrEqual(MARGIN)
      expect(rectOf(center).bottom).toBeLessThanOrEqual(small.height - MARGIN)
    })

    it('docks to a screen edge as last resort instead of covering the obstacle', () => {
      const center = placeTerminalPanel(mid, PANEL, small, MARGIN, GAP, [fanOutPanel])
      const rect = rectOf(center)
      const touchesEdge =
        rect.left <= MARGIN ||
        rect.top <= MARGIN ||
        rect.right >= small.width - MARGIN ||
        rect.bottom >= small.height - MARGIN
      expect(touchesEdge).toBe(true)
    })

    it('keeps the plain side order when nothing is in the way', () => {
      const far = { left: 800, right: 880, top: 600, bottom: 680 }
      expect(placeTerminalPanel(cube, PANEL, VIEWPORT, MARGIN, GAP, [far])).toEqual(
        placeTerminalPanel(cube, PANEL, VIEWPORT, MARGIN, GAP)
      )
    })
  })
})

describe('fitTerminalPanel', () => {
  it('keeps the full size when the viewport is roomy', () => {
    const { size } = fitTerminalPanel(cube, VIEWPORT, MARGIN, GAP)
    expect(size).toEqual(TERMINAL_PANEL_FULL)
  })

  it('shrinks to clear the cube and a HUD form in a squeezed viewport', () => {
    const viewport = { width: 900, height: 700 }
    const middle = { left: 430, top: 330, right: 470, bottom: 370 }
    const form = { left: 468, top: 12, right: 888, bottom: 430 }
    const { size, center } = fitTerminalPanel(middle, viewport, MARGIN, GAP, [form])
    const rect = {
      left: center.x - size.width / 2,
      right: center.x + size.width / 2,
      top: center.y - size.height / 2,
      bottom: center.y + size.height / 2
    }
    expect(size.width).toBeLessThan(TERMINAL_PANEL_FULL.width)
    expect(size.width).toBeGreaterThanOrEqual(TERMINAL_PANEL_MIN.width)
    expect(overlaps(rect, form)).toBe(false)
    expect(overlaps(rect, middle)).toBe(false)
  })

  it('never goes below the minimum, even when nothing fits', () => {
    const viewport = { width: 900, height: 700 }
    const everything = { left: 0, top: 0, right: 900, bottom: 700 }
    const { size } = fitTerminalPanel(cube, viewport, MARGIN, GAP, [everything])
    expect(size).toEqual(TERMINAL_PANEL_MIN)
  })

  it('caps the panel to a viewport smaller than its natural size', () => {
    const { size } = fitTerminalPanel(cube, { width: 400, height: 300 }, MARGIN, GAP)
    expect(size.width).toBeLessThanOrEqual(376)
    expect(size.height).toBeLessThanOrEqual(276)
  })
})
