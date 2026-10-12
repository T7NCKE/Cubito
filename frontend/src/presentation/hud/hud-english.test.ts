import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { COMPARE_CHIPS, connectionLabel, hudModel, hudText } from './hud-model'
import { fromParentLabel, nodeLabelModel } from './node-label-model'
import { spawnViewModel } from './spawn-view-model'
import { worktreeDeletePanelModel } from './worktree-delete-view-model'
import { demoBannerText } from './demo-banner-element'
import { commandCatalog } from '../../application/command-catalog'
import {
  connectionFailureReason,
  pairingRejectionReason
} from '../../application/connection-reason'
import { decidePairingEntry } from '../../application/pairing-entry-decision'
import { describeFailure } from '../../application/i18n/user-facing-error'
import { setActiveLanguage } from '../../application/i18n/translate'
import { emptyWorktreeGraph } from '../../domain/worktree-graph/types'
import { emptyTerminalsState } from '../../application/terminal-session-model'
import { emptySpawnMenuSlice } from '../../application/spawn-menu-model'
import type { SpawnMenuSlice } from '../../application/spawn-menu-model'
import { emptyReposSlice } from '../../application/repos-model'
import { emptyProjectSelectorSlice } from '../../application/project-selector-model'
import { emptyCommandPaletteSlice } from '../../application/command-palette-model'
import { emptyFanOutSlice } from '../../application/fan-out-model'
import { emptySystemViewSlice } from '../../application/system-view-model'
import { emptyDiffViewSlice } from '../../application/diff-view-model'
import { emptyCompareViewSlice } from '../../application/compare-view-model'
import type { SceneState } from '../../application/scene-store'
import type { WorktreeDeleteView } from '../../application/worktree-delete-flow'
import { DEFAULT_CAMERA_HEIGHT } from '../camera/camera-pose'
import { inertActivity } from '../../domain/worktree-graph/node-activity'
import { countNodeStates } from '../theme/node-state'

beforeEach(() => setActiveLanguage('en'))
afterEach(() => setActiveLanguage('es'))

const state = (overrides: Partial<SceneState> = {}): SceneState => ({
  graph: emptyWorktreeGraph(),
  sync: { state: 'idle' },
  connection: { state: 'connecting' },
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

describe('HUD in English', () => {
  it('labels every connection state', () => {
    expect(connectionLabel({ state: 'connecting' })).toBe('connecting…')
    expect(connectionLabel({ state: 'connected', runtimeId: 'r1' })).toBe('connected · runtime r1')
    expect(connectionLabel({ state: 'reconnecting', attempt: 2, nextRetryInMs: 1 })).toBe(
      'reconnecting… · attempt 2'
    )
    expect(connectionLabel({ state: 'down', reason: 'boom' })).toBe('disconnected · boom')
  })

  it('renders repo and counter lines', () => {
    const counters = countNodeStates(emptyWorktreeGraph())
    expect(hudText(null, counters).repo).toBe('no repository')
    expect(hudText({ displayName: 'Cubito', nodeCount: 4 }, counters).repo).toBe('Cubito · 4 nodes')
    const text = hudText(null, { ...counters, total: 6, working: 2, 'waiting-input': 1 })
    expect(text.countersPrefix).toBe('6 nodes · 2 active agents · ')
    expect(text.countersWaiting).toBe('1 waiting for input')
  })

  it('words the sync failure notice in English', () => {
    const model = hudModel(
      state({
        connection: { state: 'connected', runtimeId: 'r' },
        sync: {
          state: 'error',
          code: 'x',
          message: describeFailure('worktreeSync', new Error('boom'))
        }
      }),
      { isMac: true }
    )
    expect(model.syncNotice).toEqual({ lead: "couldn't refresh the worktrees", detail: 'boom' })
  })

  it('describes the keyboard chips in English', () => {
    const chips = hudModel(state({ selection: { selectedId: 'a' } }), { isMac: false }).chips
    expect(chips.map((chip) => chip.description)).toEqual([
      'navigate',
      'focus',
      'overview · fit all',
      'spawn',
      'palette',
      'projects',
      'terminal'
    ])
    expect(COMPARE_CHIPS[0]!.description).toBe('previous / next child')
  })

  it('localizes node label lines', () => {
    expect(fromParentLabel('refs/heads/main')).toBe('from main')
    expect(fromParentLabel(null)).toBe('from root')
    const node = {
      id: 'a',
      repoId: 'r',
      branch: 'feat',
      path: '/a',
      status: 'clean',
      isMain: false,
      kind: 'worktree',
      parentId: null,
      childIds: [],
      activity: inertActivity()
    } as never
    const model = nodeLabelModel(node, 'waiting-input', { diffLabel: null } as never, true)
    expect(model.secondary?.text).toBe('agent · waiting for input')
    expect(model.callout?.title.text).toBe('waiting for input')
    expect(model.callout?.hint.text).toBe('check the agent to continue')
  })
})

const form = (status: 'idle' | 'submitting'): SpawnMenuSlice => ({
  view: 'form',
  parentId: null,
  fields: { name: 'x', baseBranch: '', agent: 'none', prompt: '' },
  status,
  repoSelector: null
})

describe('spawn form in English', () => {
  it('titles the form and labels the submit button', () => {
    const idle = spawnViewModel(form('idle'), emptyWorktreeGraph())
    expect(idle).toMatchObject({ title: 'spawn child · from root', submitLabel: 'create worktree' })
    const busy = spawnViewModel(form('submitting'), emptyWorktreeGraph())
    expect(busy).toMatchObject({ submitLabel: 'creating…' })
  })

  it('labels the radial chips', () => {
    const radial = spawnViewModel(
      { view: 'radial', nodeId: 'a', repoSelector: null },
      emptyWorktreeGraph()
    )
    expect(radial).toMatchObject({
      chips: [
        { label: 'spawn child' },
        { label: 'fan-out' },
        { label: 'terminal' },
        { label: 'archive' }
      ]
    })
  })
})

const open = (
  over: Partial<Extract<WorktreeDeleteView, { phase: 'open' }>> = {}
): WorktreeDeleteView => ({
  phase: 'open',
  nodeId: 'r::/a',
  branch: 'feat-a',
  blocked: false,
  dirtyFiles: 3,
  liveTerminals: 1,
  agentStatus: 'working',
  children: ['b'],
  removing: false,
  error: null,
  forceOffered: false,
  ...over
})

describe('delete confirm in English', () => {
  it('lists the consequences with English plurals', () => {
    const model = worktreeDeletePanelModel(open())
    expect(model.title).toBe('Delete feat-a')
    expect(model.lines).toEqual([
      '3 files with uncommitted changes',
      '1 live terminal will be closed',
      'an agent is active (working)',
      'has 1 child worktree: b'
    ])
    expect(model.actionLabels).toEqual({
      idle: 'delete',
      confirm: 'confirm deletion',
      busy: 'deleting…'
    })
  })

  it('explains the main-worktree block and the force path', () => {
    const blocked = worktreeDeletePanelModel(open({ blocked: true, branch: 'main' }))
    expect(blocked.title).toBe('main is the main worktree')
    expect(blocked.lines).toEqual(["The repo's main worktree cannot be deleted."])
    expect(worktreeDeletePanelModel(open({ forceOffered: true })).actionLabels.idle).toBe(
      'force delete'
    )
  })
})

describe('command palette, banner and connection reasons in English', () => {
  it('labels the catalog commands', () => {
    const labels = commandCatalog({ isMac: false }).map((command) => command.label)
    expect(labels).toEqual([
      'focus',
      'overview · fit all',
      'open terminal',
      'spawn worktree',
      'projects',
      'add repo',
      'fan-out',
      'live system',
      'diff',
      'compare the litter',
      'delete worktree',
      'open file',
      'Idioma: Español'
    ])
  })

  it('shows the demo banner and failure reasons in English', () => {
    setActiveLanguage('en')
    expect(decidePairingEntry(null)).toEqual({ kind: 'demo', reason: 'no pairing URL' })
    expect(demoBannerText('no pairing URL')).toBe(
      'DEMO MODE — sample data, not connected to orcad (no pairing URL). Open the pairing URL to connect.'
    )
    expect(pairingRejectionReason('too_long')).toBe('invalid pairing code')
    expect(connectionFailureReason('unauthorized')).toBe('orcad rejected the token')
    expect(connectionFailureReason('whatever')).toBe('invalid response from orcad')
  })
})
