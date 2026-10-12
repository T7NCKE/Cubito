// Numbers only — no colors, no THREE. Colors live in scene-palette.ts.
// Every value here is derived from measurements of frontend/design/mockups/Main.dc.html
// and EstadosNodo.dc.html (see SDD nucleo-grafo design §1-2 for the derivations).

// ── projection ──────────────────────────────────────────────────────────
export const PX_PER_UNIT = 48.08 // mockup px per world unit — traceability only
export const PX_PER_UNIT_VERTICAL = 41.64 // = PX_PER_UNIT · cos(30°)

// ── node body ───────────────────────────────────────────────────────────
export const NODE_SIZE = 1 // cube X/Z edge = one iso grid cell
export const NODE_HEIGHT = 0.9127 // 38px vertical vs a consistent 41.64px
export const NODE_HALF_HEIGHT = NODE_HEIGHT / 2

// ── elevation ladder (world units above the ground plane) ─────────────────
// Keyed by NodeState string literal, not typed against NodeState (B4, not yet built)
// per design's stated deferral — tighten with `satisfies Record<NodeState, number>` in B7.
export const ELEVATION = {
  'waiting-input': 0.6, // 25.0px — highest: the most important state in the product
  working: 0.52, // 21.7px — measured 22
  dirty: 0.44, // 18.3px
  unread: 0.44, // 18.3px — measured 18
  spawning: 0.3, // 12.5px — between unread and idle
  idle: 0.2, // 8.3px — measured 8
  archived: 0 // grounded, and the only state with no shadow
} as const satisfies Record<string, number>

/** The root is the scene's anchor: it never sits fully down. Mockup: root gap 20px. */
export const ROOT_MIN_ELEVATION = 0.48

// ── shadow, derived from height so it is provably monotone ────────────────
export const SHADOW_BASE_RADIUS = 0.98
export const SHADOW_RADIUS_GAIN = 0.58
export const SHADOW_BASE_OPACITY = 0.315
export const SHADOW_OPACITY_GAIN = 0.26
export const SHADOW_Y = 0.005 // lift off y=0 to beat z-fighting with the grid

// ── layout (children fan around the parent on the ground) ─────────────────
export const DEPTH_STEP = 9.5
export const DEPTH_DECAY = 0.8 // depth-2 step = 7.6 (measured 7.4)
export const ROOT_FAN_SPAN_DEG = 300
export const BRANCH_FAN_SPAN_DEG = 90
export const MIN_ANGULAR_SEPARATION = NODE_SIZE * 1.8
export const ROOT_SPREAD = DEPTH_STEP * 2

// ── camera ──────────────────────────────────────────────────────────────
export const FIT_PADDING = 1.5
export const FIT_MIN_RADIUS = 6
export const FOCUS_DURATION_MS = 420
export const ORBIT_DAMPING = 0.08
export const MIN_POLAR_DEG = 15
export const MAX_POLAR_DEG = 80 // never dip below the ground plane
export const MS_PER_SECOND = 1000 // FOCUS_DURATION_MS is milliseconds; camera clock ticks in seconds

// ── camera heights (perspective presets; offsets from a world ground anchor) ──────────────────
// Not typed against CameraHeight here — that would close an import cycle through
// camera/camera-framing.ts (same trap ELEVATION documents above). See camera/height-presets.ts.
export const CAMERA_HEIGHT_PRESETS = {
  general: {
    // anchored on the galaxy centroid (design D6 fallback), not the active island's main node.
    position: { x: 19, y: 58, z: 82 },
    lookAt: { x: 0, y: 0, z: 0 },
    fov: 40,
    durationMs: 600
  },
  isla: {
    position: { x: 12, y: 15, z: 24 },
    lookAt: { x: -0.5, y: 0, z: -1.5 },
    fov: 38,
    durationMs: 420
  },
  foco: {
    position: { x: 3.4, y: 2.6, z: 4.6 },
    lookAt: { x: 0, y: 0.7, z: 0 },
    fov: 34,
    durationMs: 420
  },
  comparar: {
    position: { x: 0, y: 5.5, z: 15 },
    lookAt: { x: 0, y: 0.8, z: -8 },
    fov: 44,
    durationMs: 600
  }
} as const
export const CAMERA_NEAR = 0.1
export const CAMERA_FAR = 400
export const MIN_DOLLY_DISTANCE = 4
export const MAX_DOLLY_DISTANCE = 320
export const PICK_DRAG_SLOP_PX = 4

// ── decorations ─────────────────────────────────────────────────────────
export const SELECTION_RING_RADIUS = 1.412 // mockup rx 48 ÷ 34
export const SELECTION_RING_WIDTH = 1.5 // screen px (LineMaterial)
export const UNREAD_DOT_OFFSET = { x: 0.618, y: 0.817, z: -0.618 }
export const UNREAD_DOT_RADIUS_PX = 4
export const GLOW_SPRITE_SCALE = NODE_SIZE * 2.0
export const GLOW_SIGMA_UNITS = 7 / PX_PER_UNIT // feGaussianBlur stdDeviation=7

// ── edges (LineMaterial: linewidth is screen px, dash is world units) ─────
export const EDGE_WIDTH_NORMAL = 1.5
export const EDGE_WIDTH_FLOW = 1.5
export const EDGE_WIDTH_FAINT = 1.0
export const EDGE_OPACITY_NORMAL = 0.8
export const EDGE_OPACITY_FLOW = 0.5
export const EDGE_OPACITY_FAINT = 0.35
export const FLOW_DASH = 6 / PX_PER_UNIT
export const FLOW_GAP = 6 / PX_PER_UNIT
export const FAINT_DASH = 2 / PX_PER_UNIT
export const FAINT_GAP = 5 / PX_PER_UNIT
export const FLOW_PERIOD_SECONDS = 1.2 // CSS: dashoffset 0 → −24 over 1.2s linear
export const FLOW_CYCLES_PER_PERIOD = 2 // 24px ÷ (6+6)px

// ── pulse (CSS: pulse 1.6s ease-in-out infinite, 1 ↔ 0.4) ────────────────
export const PULSE_PERIOD_SECONDS = 1.6
export const PULSE_MIN_OPACITY = 0.4
export const PULSE_MAX_OPACITY = 1

// ── galaxy (multi-repo island layout, layout/galaxy-layout.ts) ────────────
export const GALAXY_ISLAND_GAP = 6 // world units of clearance between island bounding circles
export const GALAXY_MIN_RING_RADIUS = 12 // floor so 2 tiny islands aren't on top of each other
// ── dim (non-active island emphasis) ───────────────────────────────────────
export const DIM_OPACITY = 0.35

// ── iso grid ────────────────────────────────────────────────────────────
export const GRID_CELL = NODE_SIZE
export const GRID_HALF_EXTENT = 64
export const GRID_BASE_OPACITY = 0.55
export const GRID_MIN_ALPHA = 0.12
export const GRID_FADE_RADIUS = 48
