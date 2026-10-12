import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  COMPARE_CHIPS,
  SCENE_MODE_SWITCHER_CHIPS,
  connectionDotColor,
  connectionLabel,
  hudModel
} from './hud-model'
import { countNodeStates } from '../theme/node-state'
import { emptyWorktreeGraph } from '../../domain/worktree-graph/types'
import { emptyTerminalsState, reduceTerminals } from '../../application/terminal-session-model'
import { emptySpawnMenuSlice } from '../../application/spawn-menu-model'
import { emptyReposSlice } from '../../application/repos-model'
import { emptyProjectSelectorSlice } from '../../application/project-selector-model'
import { emptyCommandPaletteSlice } from '../../application/command-palette-model'
import { emptyFanOutSlice } from '../../application/fan-out-model'
import { emptySystemViewSlice } from '../../application/system-view-model'
import { emptyDiffViewSlice } from '../../application/diff-view-model'
import { emptyCompareViewSlice } from '../../application/compare-view-model'
import type { SceneState } from '../../application/scene-store'
import { DEFAULT_CAMERA_HEIGHT } from '../camera/camera-pose'
import { buildWorktreeGraph } from '../../domain/worktree-graph/build-graph'

const baseState = (overrides: Partial<SceneState> = {}): SceneState => ({
  graph: emptyWorktreeGraph(),
  sync: { state: 'idle' },
  connection: { state: 'down', reason: 'not connected' },
  selection: { selectedId: null },
  terminals: emptyTerminalsState(),
  spawnMenu: emptySpawnMenuSlice(),
  repos: emptyReposSlice(),
  projectSelector: emptyProjectSelectorSlice(),
  commandPalette: emptyCommandPaletteSlice(),
  fanOut: emptyFanOutSlice(),
  systemView: emptySystemViewSlice(),
  diffView: emptyDiffViewSlice(),
  compareView: emptyCompareViewSlice(),
  camera: { height: DEFAULT_CAMERA_HEIGHT },
  islandSelections: new Map(),
  rememberedLitter: [],
  ...overrides
})

describe('hudModel', () => {
  describe('syncNotice', () => {
    const failure = { lead: 'no se pudieron actualizar los worktrees', detail: 'boom' }
    const failed = { state: 'error' as const, code: 'x', message: failure }

    it('carries the sync failure while connected', () => {
      const model = hudModel(
        baseState({ sync: failed, connection: { state: 'connected', runtimeId: 'r' } }),
        { isMac: true }
      )
      expect(model.syncNotice).toBe(failure)
    })

    it('is null once a later sync succeeded', () => {
      const model = hudModel(
        baseState({
          sync: { state: 'synced', at: 1 },
          connection: { state: 'connected', runtimeId: 'r' }
        }),
        { isMac: true }
      )
      expect(model.syncNotice).toBeNull()
    })

    it('is null while the connection line already reports the outage', () => {
      const model = hudModel(baseState({ sync: failed }), { isMac: true })
      expect(model.syncNotice).toBeNull()
    })
  })

  it('connection.label shows the connecting label', () => {
    const model = hudModel(baseState({ connection: { state: 'connecting' } }), { isMac: true })
    expect(model.connection.label).toBe('conectando…')
  })

  it('connection.dotColor is amber while connecting', () => {
    const model = hudModel(baseState({ connection: { state: 'connecting' } }), { isMac: true })
    expect(model.connection.dotColor).toBe('amber')
  })

  it('connection.label includes the attempt number when reconnecting', () => {
    const model = hudModel(
      baseState({ connection: { state: 'reconnecting', attempt: 3, nextRetryInMs: 2000 } }),
      { isMac: true }
    )
    expect(model.connection.label).toBe('reconectando… · intento 3')
  })

  it('connection.label includes the runtime id when connected', () => {
    const model = hudModel(baseState({ connection: { state: 'connected', runtimeId: '4f2a9c' } }), {
      isMac: true
    })
    expect(model.connection.label).toContain('4f2a9c')
  })

  it('connection.label shows a reconnecting-specific label', () => {
    const model = hudModel(
      baseState({ connection: { state: 'reconnecting', attempt: 1, nextRetryInMs: 500 } }),
      { isMac: true }
    )
    expect(model.connection.label.toLowerCase()).toContain('reconect')
  })

  it('connection.label includes the reason when down', () => {
    const model = hudModel(
      baseState({ connection: { state: 'down', reason: 'runtime unreachable' } }),
      {
        isMac: true
      }
    )
    expect(model.connection.label).toContain('runtime unreachable')
  })

  it('connection.dotColor differs between connected and each non-connected variant', () => {
    const connected = hudModel(baseState({ connection: { state: 'connected', runtimeId: 'x' } }), {
      isMac: true
    })
    const reconnecting = hudModel(
      baseState({ connection: { state: 'reconnecting', attempt: 1, nextRetryInMs: 500 } }),
      { isMac: true }
    )
    const down = hudModel(baseState({ connection: { state: 'down', reason: 'x' } }), {
      isMac: true
    })

    expect(connected.connection.dotColor).not.toBe(reconnecting.connection.dotColor)
    expect(connected.connection.dotColor).not.toBe(down.connection.dotColor)
  })

  it('repo is null when there are 0 repos', () => {
    const model = hudModel(baseState({ repos: emptyReposSlice() }), { isMac: true })
    expect(model.repo).toBeNull()
  })

  it('repo shows the active repo displayName and its node count', () => {
    const graph = buildWorktreeGraph([
      {
        id: 'r1::/a',
        repoId: 'r1',
        branch: 'main',
        parentWorktreeId: null,
        childWorktreeIds: [],
        workspaceStatus: 'in-progress',
        git: { path: '/a', isMainWorktree: true }
      },
      {
        id: 'r1::/b',
        repoId: 'r1',
        branch: 'feat',
        parentWorktreeId: null,
        childWorktreeIds: [],
        workspaceStatus: 'in-progress',
        git: { path: '/b', isMainWorktree: false }
      },
      {
        id: 'r2::/c',
        repoId: 'r2',
        branch: 'main',
        parentWorktreeId: null,
        childWorktreeIds: [],
        workspaceStatus: 'in-progress',
        git: { path: '/c', isMainWorktree: true }
      }
    ])
    const repos = {
      list: [
        { id: 'r1', path: '/r1', displayName: 'Cubito', kind: 'git' as const },
        { id: 'r2', path: '/r2', displayName: 'Other', kind: 'git' as const }
      ],
      activeRepoId: 'r1'
    }
    const model = hudModel(baseState({ graph, repos }), { isMac: true })
    expect(model.repo).toEqual({ displayName: 'Cubito', nodeCount: 2 })
  })

  it('counters equals countNodeStates(graph) exactly — no independent computation', () => {
    const graph = emptyWorktreeGraph()
    const state = baseState({ graph })
    const model = hudModel(state, { isMac: true })
    expect(model.counters).toEqual(countNodeStates(graph))
  })

  it('chips include the Mac-labeled palette shortcut when isMac is true', () => {
    const model = hudModel(baseState(), { isMac: true })
    const paletteChip = model.chips.find((chip) => chip.description === 'paleta')
    expect(paletteChip?.key).toContain('⌘K')
  })

  it('chips include the non-Mac-labeled palette shortcut when isMac is false', () => {
    const model = hudModel(baseState(), { isMac: false })
    const paletteChip = model.chips.find((chip) => chip.description === 'paleta')
    expect(paletteChip?.key).toContain('Ctrl+K')
  })

  it('chips label f as foco and v as general · ver todo (KEY-10 cross-surface agreement)', () => {
    const model = hudModel(baseState(), { isMac: true })
    expect(model.chips).toContainEqual({ key: 'f', description: 'foco' })
    expect(model.chips).toContainEqual({ key: 'v', description: 'general · ver todo' })
  })

  it('chips include the Mac-labeled projects shortcut when isMac is true', () => {
    const model = hudModel(baseState(), { isMac: true })
    expect(model.chips).toContainEqual({ key: '⌘P', description: 'proyectos' })
  })

  it('chips include the non-Mac-labeled projects shortcut when isMac is false', () => {
    const model = hudModel(baseState(), { isMac: false })
    expect(model.chips).toContainEqual({ key: 'Ctrl+P', description: 'proyectos' })
  })

  it('adds no [t] terminal chip when no node is selected', () => {
    const model = hudModel(baseState({ selection: { selectedId: null } }), { isMac: true })
    expect(model.chips.some((chip) => chip.key === 't')).toBe(false)
  })

  it('adds a [t] terminal chip when connected, a node is selected and no terminal is open', () => {
    const model = hudModel(
      baseState({
        selection: { selectedId: 'w1' },
        connection: { state: 'connected', runtimeId: 'r1' }
      }),
      { isMac: true }
    )
    expect(model.chips).toContainEqual({ key: 't', description: 'terminal' })
  })

  it('hides the [t] terminal chip without a connection (demo mode: t does nothing)', () => {
    const model = hudModel(baseState({ selection: { selectedId: 'w1' } }), { isMac: true })
    expect(model.chips.some((chip) => chip.key === 't')).toBe(false)
  })

  it('shows pin + exit chips (no tab chip) for a single terminal open in scene placement', () => {
    const terminals = reduceTerminals(emptyTerminalsState(), {
      type: 'open-terminal-for-node',
      nodeId: 'w1'
    })
    const model = hudModel(baseState({ terminals, selection: { selectedId: 'w1' } }), {
      isMac: true
    })
    expect(model.chips).toContainEqual({ key: 'p', description: 'pin' })
    expect(model.chips).toContainEqual({ key: 'Ctrl+]', description: 'salir' })
    expect(model.chips.some((chip) => chip.key === '⇥')).toBe(false)
    expect(model.chips.some((chip) => chip.key === 't')).toBe(false)
  })

  it('adds the tab-switch chip once a second terminal is open on the same node', () => {
    let terminals = reduceTerminals(emptyTerminalsState(), {
      type: 'open-terminal-for-node',
      nodeId: 'w1'
    })
    terminals = reduceTerminals(terminals, { type: 'open-terminal-for-node', nodeId: 'w1' })
    const model = hudModel(baseState({ terminals, selection: { selectedId: 'w1' } }), {
      isMac: true
    })
    expect(model.chips).toContainEqual({ key: '⇥', description: 'otra terminal' })
  })

  it('shows escena + cerrar-panel chips once the terminal is pinned to the hud', () => {
    let terminals = reduceTerminals(emptyTerminalsState(), {
      type: 'open-terminal-for-node',
      nodeId: 'w1'
    })
    terminals = reduceTerminals(terminals, { type: 'set-placement', placement: 'hud' })
    const model = hudModel(baseState({ terminals, selection: { selectedId: 'w1' } }), {
      isMac: true
    })
    expect(model.chips).toContainEqual({ key: 'p', description: 'escena' })
    expect(model.chips).toContainEqual({ key: 'esc', description: 'cerrar panel' })
    expect(model.chips.some((chip) => chip.key === 'Ctrl+]')).toBe(false)
    expect(model.chips.some((chip) => chip.key === '⇥')).toBe(false)
  })

  it('also shows the tab-switch chip once pinned when a second terminal is open', () => {
    let terminals = reduceTerminals(emptyTerminalsState(), {
      type: 'open-terminal-for-node',
      nodeId: 'w1'
    })
    terminals = reduceTerminals(terminals, { type: 'open-terminal-for-node', nodeId: 'w1' })
    terminals = reduceTerminals(terminals, { type: 'set-placement', placement: 'hud' })
    const model = hudModel(baseState({ terminals, selection: { selectedId: 'w1' } }), {
      isMac: true
    })
    expect(model.chips).toContainEqual({ key: '⇥', description: 'otra terminal' })
  })

  // Exported (Wave 4, SV-403) so the system-view HUD can reuse them without duplicating logic.
  it('exports connectionLabel and connectionDotColor as standalone pure helpers', () => {
    expect(connectionLabel({ state: 'connected', runtimeId: '4f2a9c' })).toContain('4f2a9c')
    expect(connectionDotColor({ state: 'connected', runtimeId: '4f2a9c' })).toBe('accent')
  })

  it('never reads the global navigator to decide platform — it only takes `platform.isMac`', () => {
    const source = readFileSync(fileURLToPath(new URL('./hud-model.ts', import.meta.url)), 'utf-8')
    expect(source).not.toMatch(/\bnavigator\b/)
  })
})

describe('COMPARE_CHIPS', () => {
  it('leads with the h/l litter-navigation chip, then the whole mode switcher (Enter/m stay mouse-only, design C4)', () => {
    expect(COMPARE_CHIPS[0]).toEqual({ key: 'h l', description: 'hijo anterior / siguiente' })
    expect(COMPARE_CHIPS.slice(1)).toEqual(SCENE_MODE_SWITCHER_CHIPS)
  })
})
