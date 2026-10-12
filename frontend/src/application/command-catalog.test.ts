import { afterEach, describe, expect, it } from 'vitest'
import { setActiveLanguage } from './i18n/translate'
import { commandCatalog, toCommandAvailability } from './command-catalog'
import type { CommandAvailability, CommandId } from './command-catalog'
import type { SceneState } from './scene-store'
import { emptyWorktreeGraph } from '../domain/worktree-graph/types'
import { emptyTerminalsState } from './terminal-session-model'
import { emptySpawnMenuSlice } from './spawn-menu-model'
import { emptyReposSlice } from './repos-model'
import { emptyProjectSelectorSlice } from './project-selector-model'
import { emptyCommandPaletteSlice } from './command-palette-model'
import { emptyFanOutSlice } from './fan-out-model'
import { emptySystemViewSlice } from './system-view-model'
import { emptyDiffViewSlice } from './diff-view-model'
import { emptyCompareViewSlice } from './compare-view-model'
import { DEFAULT_CAMERA_HEIGHT } from '../presentation/camera/camera-pose'

const state = (overrides: Partial<SceneState> = {}): SceneState => ({
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

const findCommand = (catalog: ReturnType<typeof commandCatalog>, id: CommandId) => {
  const command = catalog.find((c) => c.id === id)
  if (!command) throw new Error(`missing command ${id}`)
  return command
}

const avail = (overrides: Partial<CommandAvailability> = {}): CommandAvailability => ({
  hasSelection: false,
  isConnected: false,
  hasLitter: false,
  ...overrides
})

describe('commandCatalog', () => {
  const mac = commandCatalog({ isMac: true })
  const other = commandCatalog({ isMac: false })

  it('orders the 13 commands per the proposal', () => {
    expect(mac.map((c) => c.id)).toEqual([
      'focus',
      'fit-all',
      'open-terminal',
      'open-spawn',
      'open-projects',
      'add-repo',
      'fan-out',
      'open-system',
      'open-diff',
      'open-compare',
      'delete-worktree',
      'open-file',
      'switch-language'
    ])
  })

  it('carries the static Spanish labels and keybinding hints', () => {
    expect(findCommand(mac, 'focus')).toMatchObject({ label: 'foco', keybindingHint: 'f' })
    expect(findCommand(mac, 'fit-all')).toMatchObject({
      label: 'general · ver todo',
      keybindingHint: 'v'
    })
    expect(findCommand(mac, 'open-terminal')).toMatchObject({
      label: 'abrir terminal',
      keybindingHint: 't'
    })
    expect(findCommand(mac, 'open-spawn')).toMatchObject({
      label: 'crear worktree',
      keybindingHint: 's'
    })
    expect(findCommand(mac, 'add-repo')).toMatchObject({
      label: 'agregar repo',
      keybindingHint: '—'
    })
    expect(findCommand(mac, 'fan-out')).toMatchObject({ label: 'fan-out', keybindingHint: '—' })
    expect(findCommand(mac, 'open-system')).toMatchObject({
      label: 'sistema en vivo',
      keybindingHint: 'x'
    })
    expect(findCommand(mac, 'open-diff')).toMatchObject({ label: 'diff', keybindingHint: 'd' })
    expect(findCommand(mac, 'open-compare')).toMatchObject({
      label: 'comparar la camada',
      keybindingHint: 'c'
    })
  })

  it('open-projects hint is ⌘P on Mac and Ctrl+P elsewhere', () => {
    expect(findCommand(mac, 'open-projects')).toMatchObject({
      label: 'proyectos',
      keybindingHint: '⌘P'
    })
    expect(findCommand(other, 'open-projects')).toMatchObject({
      label: 'proyectos',
      keybindingHint: 'Ctrl+P'
    })
  })

  const matrix: readonly [CommandId, CommandAvailability, boolean][] = [
    ['focus', avail({ hasSelection: true, isConnected: true }), true],
    ['focus', avail({ hasSelection: false, isConnected: true }), false],
    ['fit-all', avail({ hasSelection: false, isConnected: false }), true],
    ['open-terminal', avail({ hasSelection: true, isConnected: true }), true],
    ['open-terminal', avail({ hasSelection: true, isConnected: false }), false],
    ['open-terminal', avail({ hasSelection: false, isConnected: true }), false],
    ['open-spawn', avail({ hasSelection: false, isConnected: true }), true],
    ['open-spawn', avail({ hasSelection: false, isConnected: false }), false],
    ['open-projects', avail({ hasSelection: false, isConnected: false }), true],
    ['add-repo', avail({ hasSelection: false, isConnected: true }), true],
    ['add-repo', avail({ hasSelection: false, isConnected: false }), false],
    ['fan-out', avail({ hasSelection: true, isConnected: true }), true],
    ['fan-out', avail({ hasSelection: false, isConnected: true }), false],
    ['fan-out', avail({ hasSelection: true, isConnected: false }), false],
    ['open-system', avail({ hasSelection: true, isConnected: false }), true],
    ['open-system', avail({ hasSelection: false, isConnected: true }), false],
    ['open-diff', avail({ hasSelection: true, isConnected: false }), true],
    ['open-diff', avail({ hasSelection: false, isConnected: true }), false],
    ['delete-worktree', avail({ hasSelection: true, isConnected: true }), true],
    ['delete-worktree', avail({ hasSelection: true, isConnected: false }), false],
    ['delete-worktree', avail({ hasSelection: false, isConnected: true }), false],
    ['open-file', avail({ hasSelection: true, isConnected: true }), true],
    ['open-file', avail({ hasSelection: true, isConnected: false }), false],
    ['open-file', avail({ hasSelection: false, isConnected: true }), false],
    ['switch-language', avail(), true],
    ['open-compare', avail({ hasLitter: true }), true],
    ['open-compare', avail({ hasLitter: false }), false],
    // selection/connection are irrelevant to open-compare — only hasLitter gates it.
    ['open-compare', avail({ hasSelection: true, isConnected: true, hasLitter: false }), false],
    ['open-compare', avail({ hasSelection: false, isConnected: false, hasLitter: true }), true]
  ]

  it.each(matrix)('%s isAvailable(%o) => %s', (id, availability, expected) => {
    expect(findCommand(mac, id).isAvailable(availability)).toBe(expected)
  })
})

describe('toCommandAvailability', () => {
  it('hasSelection reflects a non-null selectedId', () => {
    expect(toCommandAvailability(state()).hasSelection).toBe(false)
    expect(toCommandAvailability(state({ selection: { selectedId: 'w1' } })).hasSelection).toBe(
      true
    )
  })

  it('isConnected is true only when connection.state is connected', () => {
    expect(
      toCommandAvailability(state({ connection: { state: 'connected', runtimeId: 'rt-1' } }))
        .isConnected
    ).toBe(true)
    expect(
      toCommandAvailability(
        state({ connection: { state: 'reconnecting', attempt: 1, nextRetryInMs: 100 } })
      ).isConnected
    ).toBe(false)
    expect(toCommandAvailability(state({ connection: { state: 'connecting' } })).isConnected).toBe(
      false
    )
    expect(
      toCommandAvailability(state({ connection: { state: 'down', reason: 'x' } })).isConnected
    ).toBe(false)
  })

  it('hasLitter is true for a running fan-out with created children, or a remembered litter still in the graph', () => {
    expect(toCommandAvailability(state()).hasLitter).toBe(false)
    expect(
      toCommandAvailability(
        state({
          fanOut: {
            view: 'form',
            parentId: 'w1',
            fields: { count: 3, agent: 'none', prompt: '' },
            repoSelector: null
          }
        })
      ).hasLitter
    ).toBe(false)
    expect(
      toCommandAvailability(
        state({
          fanOut: {
            view: 'running',
            parentId: 'w1',
            fields: { count: 1, agent: 'none', prompt: '' },
            repoSelector: 'id:repo-a',
            batch: [
              {
                mutationId: 'm0',
                worktreeId: 'w2',
                failed: false,
                dispatchId: null,
                taskId: null
              }
            ],
            memberStatus: {},
            runId: null
          }
        })
      ).hasLitter
    ).toBe(true)
    expect(toCommandAvailability(state({ rememberedLitter: ['gone'] })).hasLitter).toBe(false)
  })
})

describe('switch-language command', () => {
  afterEach(() => setActiveLanguage('es'))

  it('labels the target language in its own tongue and never needs a connection', () => {
    setActiveLanguage('es')
    expect(findCommand(commandCatalog({ isMac: true }), 'switch-language')).toMatchObject({
      label: 'Language: English',
      keybindingHint: '—'
    })
    setActiveLanguage('en')
    expect(findCommand(commandCatalog({ isMac: true }), 'switch-language').label).toBe(
      'Idioma: Español'
    )
  })
})
