import * as THREE from 'three'
import { createSceneStore } from './application/scene-store'
import { syncWorktreeGraph } from './application/sync-worktree-graph'
import { createLiveWorktreeSync } from './application/live-worktree-sync'
import type { LiveSyncConnection } from './application/live-worktree-sync'
import { decidePairingEntry } from './application/pairing-entry-decision'
import {
  clearStoredPairing,
  resolvePairingSource,
  tryGetSessionStorage
} from './application/pairing-source'
import { connectOrcad } from './infrastructure/rpc/connect-orcad'
import { consumePairingFragment } from './infrastructure/rpc/pairing-fragment'
import type { RuntimeGateway } from './application/ports/runtime-gateway'
import type { RawWorktreeRecord } from './domain/worktree-graph/build-graph'
import type { Vec3 } from './presentation/camera/camera-framing'
import { createCameraHeightController } from './presentation/input/camera-height-controller'
import { bindPointerPicking } from './bind-pointer-picking'
import { createFanOutBinder } from './bind-fan-out'
import { createSystemViewBinder } from './bind-system-view'
import { demoSystemGraph } from './demo-system-graph'
import { createDiffViewBinder } from './bind-diff-view'
import { createCompareViewBinder } from './bind-compare-view'
import { bindLitterMemory } from './bind-litter-memory'
import { createWorktreeDeleteBinder } from './bind-worktree-delete'
import { createFileWorkspaceBinder } from './bind-file-workspace'
import { createSourceControlBinder } from './bind-source-control'
import { createHudOverlay } from './presentation/hud/hud-overlay'
import { createDemoBanner } from './presentation/hud/demo-banner-element'
import { createAttentionNotificationBinder } from './bind-attention-notifications'
import { createAttentionToastHost } from './presentation/hud/attention-toast-host'
import { createBrowserNotificationPresenter } from './presentation/hud/browser-notification-presenter'
import { hudModel } from './presentation/hud/hud-model'
import { createKeyboardBar } from './presentation/hud/keyboard-bar'
import { createTerminalConnector } from './presentation/hud/terminal-connector-element'
import type { LabelRect } from './presentation/hud/label-collision-model'
import { createTerminalPanel } from './presentation/hud/terminal-panel-element'
import { createTerminalPanelController } from './presentation/hud/terminal-panel-controller'
import type { TerminalPanelController } from './presentation/hud/terminal-panel-controller'
import { createSpawnMenu } from './presentation/hud/spawn-menu-element'
import { createSpawnForm } from './presentation/hud/spawn-form-element'
import { createSpawnMenuController } from './presentation/hud/spawn-menu-controller'
import type { SpawnMenuController } from './presentation/hud/spawn-menu-controller'
import { projectToScreen } from './presentation/hud/terminal-connector-projector'
import { createProjectSelector } from './presentation/hud/project-selector-element'
import { createProjectSelectorController } from './presentation/hud/project-selector-controller'
import type { ProjectSelectorController } from './presentation/hud/project-selector-controller'
import { createCommandPalette } from './presentation/hud/command-palette-element'
import { createCommandPaletteController } from './presentation/hud/command-palette-controller'
import { createKeyboardController } from './presentation/input/keyboard-controller'
import { createCameraRig } from './presentation/scene/camera-rig'
import { createScene } from './presentation/scene/create-scene'
import { createGraphView } from './presentation/scene/graph-view'
import { needsRemeasure } from './presentation/scene/canvas-box-remeasure'
import type { CanvasBox } from './presentation/scene/canvas-box-remeasure'
import { sceneSelectedId } from './application/compare-view-model'
import { fanOutParentId } from './application/fan-out-model'
import { switchLanguage } from './application/i18n/language-preference'
import { activeLanguage, setActiveLanguage, t } from './application/i18n/translate'
import { applyCssTheme } from './presentation/theme/css-theme'
import { FOCUS_DURATION_MS } from './presentation/theme/scene-metrics'
import { paletteFor } from './presentation/theme/scene-palette'
import type { Theme } from './presentation/theme/scene-palette'

// Demo gateway until the orcad connection (pairing or local bridge) lands.
// Shape matches the real `worktree.list` payload observed against orcad; the optional
// activity fields exercise the state ladder for the visual calibration pass.
const demoRecords: RawWorktreeRecord[] = [
  {
    id: 'demo::/repo',
    branch: 'refs/heads/main',
    parentWorktreeId: null,
    childWorktreeIds: ['demo::/wt/alpha', 'demo::/wt/beta', 'demo::/wt/delta'],
    workspaceStatus: 'in-progress',
    git: { path: '/repo', isMainWorktree: true }
  },
  {
    id: 'demo::/wt/alpha',
    branch: 'refs/heads/cubito-alpha',
    parentWorktreeId: 'demo::/repo',
    childWorktreeIds: ['demo::/wt/gamma'],
    workspaceStatus: 'in-progress',
    git: { path: '/wt/alpha', isMainWorktree: false },
    agentStatus: 'working'
  },
  {
    id: 'demo::/wt/beta',
    branch: 'refs/heads/cubito-beta',
    parentWorktreeId: 'demo::/repo',
    childWorktreeIds: [],
    workspaceStatus: 'in-progress',
    git: { path: '/wt/beta', isMainWorktree: false },
    agentStatus: 'waiting-input'
  },
  {
    id: 'demo::/wt/gamma',
    branch: 'refs/heads/cubito-gamma',
    parentWorktreeId: 'demo::/wt/alpha',
    childWorktreeIds: [],
    workspaceStatus: 'in-progress',
    git: { path: '/wt/gamma', isMainWorktree: false },
    isUnread: true,
    diff: { added: 412, removed: 38 }
  },
  {
    id: 'demo::/wt/delta',
    branch: 'refs/heads/cubito-delta',
    parentWorktreeId: 'demo::/repo',
    childWorktreeIds: [],
    workspaceStatus: 'archived',
    git: { path: '/wt/delta', isMainWorktree: false },
    isArchived: true
  }
]

const demoGateway: RuntimeGateway = {
  listWorktrees: async () => demoRecords,
  listRepos: async () => [],
  createWorktree: async () => {
    throw new Error('createWorktree not implemented in the demo gateway')
  },
  addRepo: async () => {
    throw new Error('addRepo not implemented in the demo gateway')
  },
  listWorktreePs: async () => [],
  gitStatus: async () => ({ entries: [], branch: '', branchLineTotal: 0 }),
  gitBranchCompare: async () => ({
    changedFiles: 0,
    commitsAhead: 0,
    commitsBehind: 0,
    baseRef: '',
    headOid: '',
    mergeBase: '',
    status: '',
    entries: []
  }),
  gitBranchDiff: async () => {
    throw new Error('gitBranchDiff not implemented in the demo gateway')
  },
  gitWorkingTreeDiff: async () => {
    throw new Error('gitWorkingTreeDiff not implemented in the demo gateway')
  },
  systemSnapshot: async () => ({ nodes: [], edges: [] }),
  orchestrationRunCreate: async () => {
    throw new Error('orchestrationRunCreate not implemented in the demo gateway')
  },
  orchestrationTaskCreate: async () => {
    throw new Error('orchestrationTaskCreate not implemented in the demo gateway')
  },
  orchestrationWorkerStart: async () => {
    throw new Error('orchestrationWorkerStart not implemented in the demo gateway')
  },
  orchestrationWorkerList: async () => {
    throw new Error('orchestrationWorkerList not implemented in the demo gateway')
  },
  orchestrationWorkerShow: async () => {
    throw new Error('orchestrationWorkerShow not implemented in the demo gateway')
  },
  orchestrationGateList: async () => {
    throw new Error('orchestrationGateList not implemented in the demo gateway')
  },
  orchestrationGateResolve: async () => {
    throw new Error('orchestrationGateResolve not implemented in the demo gateway')
  },
  orchestrationQuestionList: async () => {
    throw new Error('orchestrationQuestionList not implemented in the demo gateway')
  },
  orchestrationQuestionAnswer: async () => {
    throw new Error('orchestrationQuestionAnswer not implemented in the demo gateway')
  },
  gitMergeWinnerIntoParent: async () => {
    throw new Error('gitMergeWinnerIntoParent not implemented in the demo gateway')
  },
  gitSourceControlStatus: async () => ({
    branch: '',
    entries: [],
    hasUpstream: false,
    ahead: 0,
    behind: 0
  }),
  gitStage: async () => undefined,
  gitUnstage: async () => undefined,
  gitCommit: async () => {
    throw new Error('gitCommit not implemented in the demo gateway')
  },
  gitPush: async () => {
    throw new Error('gitPush not implemented in the demo gateway')
  },
  hostedReviewEligibility: async () => {
    throw new Error('hostedReviewEligibility not implemented in the demo gateway')
  },
  hostedReviewCreate: async () => {
    throw new Error('hostedReviewCreate not implemented in the demo gateway')
  },
  filesSearchPaths: async () => {
    throw new Error('filesSearchPaths not implemented in the demo gateway')
  },
  filesRead: async () => {
    throw new Error('filesRead not implemented in the demo gateway')
  },
  filesStat: async () => {
    throw new Error('filesStat not implemented in the demo gateway')
  },
  filesWrite: async () => {
    throw new Error('filesWrite not implemented in the demo gateway')
  },
  worktreeRemove: async () => {
    throw new Error('worktreeRemove not implemented in the demo gateway')
  },
  agentActivity: async () => ({ events: [], latestSeq: 0 }),
  repoSetupCommand: async () => null,
  repoSetupInfo: async () => ({ local: null, shared: null, known: true }),
  setRepoSetupCommand: async () => {
    throw new Error('setRepoSetupCommand not implemented in the demo gateway')
  }
}

const container = document.getElementById('app')
const hud = document.getElementById('hud')
const keyboardBarSlot = document.getElementById('keyboard-bar')
const systemSlot = document.getElementById('system')
const systemGraphSlot = document.getElementById('system-graph-viewport')
const diffSlot = document.getElementById('diff')
const compareSlot = document.getElementById('compare')
if (
  !container ||
  !hud ||
  !keyboardBarSlot ||
  !systemSlot ||
  !systemGraphSlot ||
  !diffSlot ||
  !compareSlot
) {
  throw new Error(
    'index.html must provide #app, #hud, #system, #system-graph-viewport, #diff, #compare and #keyboard-bar'
  )
}
const hudElement: HTMLElement = hud

setActiveLanguage(activeLanguage()) // syncs <html lang> with the resolved language

const theme: Theme = 'dark'
const palette = paletteFor(theme)
applyCssTheme(document.documentElement, palette)

const cubitoScene = createScene(container, palette)
const graphView = createGraphView(cubitoScene.scene, cubitoScene.labelLayer)
const cameraRig = createCameraRig(cubitoScene.camera, cubitoScene.controls)
const store = createSceneStore()
const heights = createCameraHeightController({ store, rig: cameraRig, scenePositions: graphView })
bindPointerPicking({
  store,
  canvas: cubitoScene.renderer.domElement,
  camera: cubitoScene.camera,
  pickableObjects: graphView.pickableObjects,
  heights
})

const hudOverlay = createHudOverlay()
hud.appendChild(hudOverlay.root)
const keyboardBar = createKeyboardBar()
keyboardBarSlot.appendChild(keyboardBar.root)

const platform = { isMac: navigator.userAgent.includes('Mac') }

// Terminal (design Area 6/7/8): the panel controller needs a live `TerminalStreamPort`, which
// only exists once the paired connection resolves — it is built lazily on the first
// `onConnected` below and rebound (not recreated) on every reconnect. The keyboard controller
// is constructed before that, so it talks to it through a closure-backed proxy.
let terminalController: TerminalPanelController | null = null
let viewportSize = { width: window.innerWidth, height: window.innerHeight }

// Spawn (design Area 3): unlike the terminal, spawn only needs the RPC gateway (no stream
// port), but construction still waits for the first `onConnected` — mirroring the terminal's
// lifecycle keeps both controllers built from the same lazy pattern. `spawnGateway` tracks the
// live connection's gateway so `refetch` always calls through the CURRENT connection, even
// though the controller itself is only ever built once.
let spawnController: SpawnMenuController | null = null
let spawnGateway: RuntimeGateway = demoGateway

// Projects (design Area 8): same lazy-on-first-connect pattern as spawn — the selector needs
// `listRepos`/`addRepo` from the live gateway, so it stays null in demo mode (`pnpm dev`); ⌘P
// still dispatches `open` into the store, it just has nothing to mount.
let projectSelectorController: ProjectSelectorController | null = null
let projectsGateway: RuntimeGateway = demoGateway

// Fan-out (design camada): same lazy-on-first-connect pattern as spawn/projects, extracted to
// its own module (main.ts max-lines ratchet) — the controller owns a `memberPoll` (worktree.ps
// loop), rebuilt once and rebound alongside the gateway on reconnect.
const fanOutBinder = createFanOutBinder({
  store,
  hud: hudElement,
  nodeCenter: (id) => graphView.nodeCenter(id),
  animateTo: (framing, durationMs) => heights.animateToExtent(framing, durationMs),
  focusDurationMs: FOCUS_DURATION_MS,
  demoGateway
})

// Sistema en vivo (design camada): eager, unlike terminal/spawn/projects — the demo graph port
// works offline, so there is no lazy-on-connect gate. `rebindGateway` below swaps in the real
// gateway on connect, same as diffViewBinder; until then (or on an old host) it stays on the
// scripted stub via demoGraphPort.
const systemViewBinder = createSystemViewBinder({
  store,
  systemSlot,
  graphSlot: systemGraphSlot,
  keyboardBarSlot,
  demoGraphPort: demoSystemGraph,
  demoGateway
})

// Diff (design camada): same eager pattern as sistema en vivo — unlike terminal/spawn/projects,
// no lazy-on-connect gate; the demo gateway's stubs let `pnpm dev` open diff mode too.
// `rebindGateway` below swaps in the real gateway on connect.
const diffViewBinder = createDiffViewBinder({
  store,
  diffSlot,
  keyboardBarSlot,
  demoGateway
})

// Commit/push composer + rail stage toggles (U2): follows diff mode, gateway swapped in on connect.
const sourceControlBinder = createSourceControlBinder({
  store,
  slot: diffSlot,
  demoGateway,
  diff: diffViewBinder
})

// Comparar la camada (design camada, Change D): same eager pattern as sistema en vivo/diff — no
// lazy-on-connect gate; the demo gateway's gitBranchCompare stub lets `pnpm dev` open compare
// mode too. `rebindGateway` below swaps in the real gateway on connect.
const compareViewBinder = createCompareViewBinder({
  store,
  compareSlot,
  keyboardBarSlot,
  demoGateway,
  heights
})

// Shared by the keyboard controller and the eager command-palette controller below — both talk
// to the terminal panel through the same closure-backed proxy (built before it exists).
const terminalCommands = {
  focusActivePanel: () => terminalController?.focusActivePanel(),
  closeActiveSession: () => terminalController?.closeActiveSession()
}

// Remove worktree (U1): eager like the palette; the gateway is swapped in on connect.
const worktreeDeleteBinder = createWorktreeDeleteBinder({
  store,
  hud: hudElement,
  demoGateway,
  onSelectionSettled: (selectedId) => heights.onSelectionChanged(selectedId)
})

// Quick-open + file pane (U4): mounts on the body because diff/system modes hide the HUD.
const fileWorkspaceBinder = createFileWorkspaceBinder({
  slot: document.body,
  demoGateway,
  hostIdOf: (nodeId) => store.get().graph.nodes.get(nodeId)?.hostId,
  onSaved: () => {
    diffViewBinder.refresh()
    sourceControlBinder.reload()
  }
})

const keyboardController = createKeyboardController({
  store,
  heights,
  terminal: terminalCommands,
  diff: diffViewBinder,
  worktreeDelete: worktreeDeleteBinder,
  fileWorkspace: fileWorkspaceBinder,
  platform,
  notice: (body) =>
    attentionToasts.show({
      notificationId: null,
      seq: null,
      title: t('compare.hudMode'),
      body,
      worktreeId: null,
      agentState: null
    })
})
keyboardController.attach(window)

// Command palette (design Area 4/6): unlike terminal/spawn/projects, the palette makes no
// gateway calls — every dep exists at startup, so it is built EAGERLY, not on first connect.
// Connection-dependent commands (open-terminal/open-spawn/add-repo) report unavailable via the
// catalog's isAvailable predicates until connection.state === 'connected'.
const commandPaletteController = createCommandPaletteController({
  store,
  heights,
  terminal: terminalCommands,
  worktreeDelete: worktreeDeleteBinder,
  fileWorkspace: fileWorkspaceBinder,
  createElement: createCommandPalette,
  hud: hudElement,
  platform,
  language: { switchTo: switchLanguage }
})

// Click-away exit: only a mousedown that lands directly on the WebGL canvas counts as
// "away" — the in-scene terminal panel's CSS2DObject is also a `container` descendant
// (positioned above the canvas), so a click inside it must never blur it right back out.
container.addEventListener('mousedown', (event) => {
  if (event.target === cubitoScene.renderer.domElement) {
    terminalController?.exitFocus()
  }
})

cubitoScene.onFrame((elapsedSeconds) => {
  graphView.tick(elapsedSeconds)
  cameraRig.tick(elapsedSeconds)
  terminalController?.tick()
  spawnController?.tick()
  graphView.resolveLabelOverlaps(projectLabelAnchor)
})

cubitoScene.onResize((width, height) => {
  cameraRig.setAspect(width / height)
  graphView.setResolution(width, height)
  viewportSize = { width, height }
  compareViewBinder.onViewportResize()
})

// The first non-empty graph gets an initial fit; afterwards the camera is the user's.
let framed = false
// Re-measures the renderer when the canvas becomes visible again, or the compare side panel
// opens/closes (design compare-side-panel D8): while a scene-replacing mode is open, #app is
// `hidden` (0×0 clientWidth/Height), so a resize during that window is missed; while the panel
// is open, #app is narrowed, so the aspect must be recomputed at the new width.
let previousBox: CanvasBox = { hidden: false, narrowed: false }

store.subscribe((state) => {
  // Canvas box FIRST: bind-compare-view computes its camada pose from rig.currentAspect(), so
  // the panel must already be laid out and the renderer remeasured before it syncs.
  const sceneReplacingOpen = state.systemView.view === 'open' || state.diffView.view === 'open'
  const compareOpen = state.compareView.view === 'open'
  container.hidden = sceneReplacingOpen
  hudElement.hidden = keyboardBar.root.hidden = sceneReplacingOpen || compareOpen
  document.body.dataset.comparePanel = compareOpen ? 'open' : 'closed'
  document.body.dataset.systemPanel = state.systemView.view === 'open' ? 'open' : 'closed'
  const box: CanvasBox = { hidden: sceneReplacingOpen, narrowed: compareOpen }
  // clientWidth inside remeasure() flushes style+layout, so the attribute above is already live.
  if (needsRemeasure(previousBox, box)) cubitoScene.remeasure()
  previousBox = box

  graphView.update({
    graph: state.graph,
    selectedId: sceneSelectedId(state.compareView, state.selection.selectedId),
    palette,
    activeRepoId: state.repos.activeRepoId,
    cameraHeight: state.camera.height,
    labelAnchorId: fanOutParentId(state.fanOut)
  })
  const model = hudModel(state, platform)
  hudOverlay.apply(model)
  keyboardBar.apply(model.chips)
  terminalController?.sync(state.terminals)
  spawnController?.sync(state.spawnMenu, state.graph)
  projectSelectorController?.sync(state.projectSelector, state.repos)
  fanOutBinder.sync()
  systemViewBinder.sync()
  diffViewBinder.sync()
  sourceControlBinder.sync()
  compareViewBinder.sync()
  commandPaletteController.sync(state.commandPalette, state)
  if (!framed && state.graph.nodes.size > 0) {
    framed = true
    heights.goTo('isla')
  }
})

/** Impure THREE camera projection (design Area 6) — the only place this math is allowed to
 *  touch `three` directly; the pure remainder lives in terminal-connector-projector.ts.
 *  Scratch vector hoisted — called per label per frame plus by the terminal connector. */
const projectionScratch = new THREE.Vector3()
const projectWorldToNdc = (world: Vec3): { x: number; y: number; z: number } => {
  projectionScratch.set(world.x, world.y, world.z)
  projectionScratch.project(cubitoScene.camera)
  return { x: projectionScratch.x, y: projectionScratch.y, z: projectionScratch.z }
}

/** Label anchor projection for the per-frame collision pass (design D3) — reuses the same
 *  pure NDC->px projector as the terminal connector overlay (terminal-connector-projector.ts). */
const projectLabelAnchor = (ground: Vec3): { x: number; y: number; visible: boolean } =>
  projectToScreen(projectWorldToNdc(ground), viewportSize.width, viewportSize.height)

const HUD_OBSTACLE_SELECTOR = '.cubito-fanout-form, .cubito-spawn-form, #keyboard-bar'

/** Visible HUD panels in viewport px — the terminal placement routes around them. */
const hudObstacleRects = (): LabelRect[] =>
  Array.from(document.querySelectorAll<HTMLElement>(HUD_OBSTACLE_SELECTOR))
    .filter((el) => !el.hidden && el.offsetWidth > 0 && el.offsetHeight > 0)
    .map((el) => el.getBoundingClientRect())

/** Builds the terminal controller on the first connection, rebinds its port on every
 *  reconnect thereafter (design Area 7) — the xterm instance/DOM panel is never recreated. */
function bindTerminals(connection: LiveSyncConnection): void {
  if (terminalController) {
    terminalController.rebind(connection.terminals)
  } else {
    terminalController = createTerminalPanelController({
      port: connection.terminals,
      createPanel: createTerminalPanel,
      createConnector: createTerminalConnector,
      labelLayer: cubitoScene.labelLayer,
      hud: hudElement,
      dispatch: (action) => store.dispatchTerminal(action),
      nodeCenter: (id) => graphView.nodeCenter(id),
      cubeRect: (id) => graphView.nodeCubeRect(id, projectLabelAnchor),
      projectToNdc: projectWorldToNdc,
      viewport: () => viewportSize,
      obstacles: hudObstacleRects
    })
    terminalController.sync(store.get().terminals)
  }
  store.dispatchTerminal({ type: 'connection-regained' })
}

/** Builds the spawn menu controller on the first connection (lazy, mirroring `bindTerminals`);
 *  every later reconnect just rebinds the gateway reference (design Area 3/7). */
function bindSpawn(connection: LiveSyncConnection): void {
  spawnGateway = connection.gateway
  if (spawnController) {
    spawnController.rebindGateway(connection.gateway)
    return
  }
  spawnController = createSpawnMenuController({
    gateway: connection.gateway,
    createMenu: createSpawnMenu,
    createForm: createSpawnForm,
    labelLayer: cubitoScene.labelLayer,
    hud: hudElement,
    dispatch: (action) => store.dispatchSpawn(action),
    nodeCenter: (id) => graphView.nodeCenter(id),
    refetch: () => syncWorktreeGraph(spawnGateway, store),
    selectCreated: (worktreeId) => {
      if (store.get().graph.nodes.has(worktreeId)) store.select(worktreeId)
    },
    activeRepoId: () => store.get().repos.activeRepoId
  })
  spawnController.sync(store.get().spawnMenu, store.get().graph)
}

/** Builds the ⌘P selector controller on the first connection (lazy, mirroring `bindSpawn`);
 *  every later reconnect just rebinds the gateway reference (design Area 4/7/8). */
function bindProjects(connection: LiveSyncConnection): void {
  projectsGateway = connection.gateway
  if (projectSelectorController) {
    projectSelectorController.rebindGateway(connection.gateway)
    return
  }
  projectSelectorController = createProjectSelectorController({
    gateway: connection.gateway,
    createElement: createProjectSelector,
    hud: hudElement,
    dispatch: (action) => store.dispatchProjectSelector(action),
    reposDispatch: (action) => store.dispatchRepos(action),
    focusIsland: (repoId) => heights.reanchorIsland(repoId),
    refetch: () => syncWorktreeGraph(projectsGateway, store)
  })
  projectSelectorController.sync(store.get().projectSelector, store.get().repos)
}

const selectAttentionWorktree = (worktreeId: string): void => {
  if (store.get().graph.nodes.has(worktreeId)) store.select(worktreeId)
}
const attentionToasts = createAttentionToastHost(document, document.body, {
  onActivate: selectAttentionWorktree
})
const browserNotifications = createBrowserNotificationPresenter({
  notificationApi: typeof Notification === 'undefined' ? undefined : Notification,
  isSecureContext: window.isSecureContext,
  isPageVisible: () => document.visibilityState === 'visible',
  focusWindow: () => window.focus(),
  onActivate: selectAttentionWorktree
})
// Why: Notification.requestPermission only prompts from a user gesture.
document.addEventListener('pointerdown', () => browserNotifications.requestPermissionOnce(), {
  once: true
})
const attentionBinder = createAttentionNotificationBinder({
  toast: (notification) => attentionToasts.show(notification),
  os: (notification) => browserNotifications.present(notification)
})

const pairingStorage = tryGetSessionStorage()
bindLitterMemory(store, pairingStorage)
const pairingEntry = decidePairingEntry(
  resolvePairingSource(consumePairingFragment(), pairingStorage)
)
if (pairingEntry.kind === 'connect') {
  createLiveWorktreeSync({
    connect: () => connectOrcad(pairingEntry.offer),
    store,
    isDocumentHidden: () => document.hidden,
    onVisibilityChange: (cb) => {
      document.addEventListener('visibilitychange', cb)
      return () => document.removeEventListener('visibilitychange', cb)
    },
    onConnected: (connection) => {
      bindTerminals(connection)
      bindSpawn(connection)
      bindProjects(connection)
      fanOutBinder.bind(connection)
      attentionBinder.bind(connection)
      worktreeDeleteBinder.rebindGateway(connection.gateway)
      fileWorkspaceBinder.rebindGateway(connection.gateway)
      systemViewBinder.rebindGateway(connection.gateway, connection.systemGraphStream)
      diffViewBinder.rebindGateway(connection.gateway)
      sourceControlBinder.rebindGateway(connection.gateway)
      compareViewBinder.rebindGateway(connection.gateway, connection.capabilities)
    },
    onDisconnected: () => store.dispatchTerminal({ type: 'connection-lost' }),
    onAuthRejected: () => clearStoredPairing(pairingStorage)
  }).start()
} else {
  store.update({ connection: { state: 'down', reason: pairingEntry.reason } })
  document.body.appendChild(createDemoBanner(document, pairingEntry.reason))
  void syncWorktreeGraph(demoGateway, store) // `pnpm dev` stays usable with no container
}
