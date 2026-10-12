import { t } from '../../application/i18n/translate'
import { describeFailure, plainFailure } from '../../application/i18n/user-facing-error'
import type { Vec3 } from '../camera/camera-framing'
import type { WorktreeGraph, WorktreeId } from '../../domain/worktree-graph/types'
import type { SpawnMenuAction, SpawnMenuSlice } from '../../application/spawn-menu-model'
import { generatedWorktreeName, toCreateWorktreeInput } from '../../application/spawn-menu-model'
import { repoSelectorForNode } from '../../application/anchor-repo-selector'
import type { RuntimeGateway } from '../../application/ports/runtime-gateway'
import type { LabelRect } from './label-collision-model'
import type { SpawnMenuHandle } from './spawn-menu-element'
import type { SpawnFormHandle } from './spawn-form-element'
import { createSetupHintTracker } from '../../application/repo-setup-hint'
import { repoSetupSaved } from '../../application/repo-setup-saved'
import { spawnViewModel } from './spawn-view-model'

/** Matches `.cubito-spawn-menu` padding-left: the clearance never drops below the default look. */
const RADIAL_MIN_CLEARANCE_PX = 60
/** Space between a zoomed-in cube's edge and the first chip. */
const RADIAL_CUBE_GAP = 14

/** Only the two methods spawn needs — narrow like the other controller ports in this dir. */
export type SpawnGatewayPort = Pick<
  RuntimeGateway,
  'listRepos' | 'createWorktree' | 'repoSetupCommand'
>

export type SpawnMenuControllerDeps = {
  gateway: SpawnGatewayPort
  createMenu: () => SpawnMenuHandle
  createForm: () => SpawnFormHandle
  labelLayer: { add(object: unknown): void; remove(object: unknown): void }
  hud: { appendChild(element: unknown): void }
  dispatch: (action: SpawnMenuAction) => void
  nodeCenter: (nodeId: WorktreeId) => Vec3 | null
  /** Projected screen rect of a node's cube — the radial's chips must start past its edge. */
  cubeRect?: (nodeId: WorktreeId) => LabelRect | null
  /** Fired after a successful create — snappier than waiting for the 2s live-sync poll. */
  refetch: () => Promise<void>
  /** Selects the new node once the post-create refetch has put it in the graph. */
  selectCreated?: (worktreeId: WorktreeId) => void
  /** Injectable for deterministic tests; defaults to the real UUID generator. */
  generateMutationId?: () => string
  /** Repos slice's active repo (design Area 8) — preferred over `repos[0]` when resolving the selector. */
  activeRepoId?: () => string | null
}

export type SpawnMenuController = {
  sync(spawnMenu: SpawnMenuSlice, graph: WorktreeGraph): void
  tick(): void
  rebindGateway(gateway: SpawnGatewayPort): void
  dispose(): void
}

/**
 * Owns the spawn radial/form lifecycle (design Area 3), mirroring terminal-panel-controller.ts:
 * mounts/unmounts the CSS2DObject radial or the HUD form as `spawnMenu.view` changes, resolves
 * the repo selector once via `listRepos()`, and drives `createWorktree` on submit.
 */
export function createSpawnMenuController(deps: SpawnMenuControllerDeps): SpawnMenuController {
  let gateway = deps.gateway
  let menu: SpawnMenuHandle | null = null
  let form: SpawnFormHandle | null = null
  let currentNodeId: WorktreeId | null = null
  let currentSlice: SpawnMenuSlice = { view: 'closed', repoSelector: null }
  let currentGraph: WorktreeGraph | null = null
  let repoFetchInFlight = false
  let syncGeneration = 0

  const setupHints = createSetupHintTracker({
    probe: (repoSelector) => gateway.repoSetupCommand(repoSelector),
    invalidations: repoSetupSaved,
    onChange: () => {
      if (currentGraph) controller.sync(currentSlice, currentGraph)
    }
  })

  const generateMutationId = deps.generateMutationId ?? (() => crypto.randomUUID())
  const activeRepoId = deps.activeRepoId ?? (() => null)

  const unmountMenu = (): void => {
    if (!menu) return
    deps.labelLayer.remove(menu.object)
    menu.dispose()
    menu = null
    currentNodeId = null
  }

  const unmountForm = (): void => {
    if (!form) return
    form.dispose()
    form = null
  }

  const mountMenu = (): SpawnMenuHandle => {
    if (!menu) {
      menu = deps.createMenu()
      deps.labelLayer.add(menu.object)
    }
    return menu
  }

  const mountForm = (): SpawnFormHandle => {
    if (!form) {
      const created = deps.createForm()
      created.onFieldChange((field, value) => deps.dispatch({ type: 'update-field', field, value }))
      created.onCancel(() => deps.dispatch({ type: 'cancel' }))
      created.onSubmit(() => void handleSubmit())
      deps.hud.appendChild(created.element)
      form = created
      created.focusFirstField()
    }
    return form
  }

  // Anchored opens derive the repo from the node itself (re-derived every sync, so a selector
  // cached from an earlier open on another repo never leaks); only rootless opens list repos.
  const maybeFetchRepoSelector = (slice: SpawnMenuSlice, graph: WorktreeGraph): void => {
    if (slice.view === 'closed') return
    const anchorId = slice.view === 'radial' ? slice.nodeId : slice.parentId
    const anchored = repoSelectorForNode(graph, anchorId)
    if (anchored !== null) {
      if (slice.repoSelector !== anchored) {
        deps.dispatch({ type: 'set-repo-selector', repoSelector: anchored })
      }
      return
    }
    if (slice.repoSelector !== null || repoFetchInFlight) return
    repoFetchInFlight = true
    void gateway
      .listRepos()
      .then((repos) => {
        const id = activeRepoId() ?? repos[0]?.id
        if (id) deps.dispatch({ type: 'set-repo-selector', repoSelector: `id:${id}` })
      })
      .finally(() => {
        repoFetchInFlight = false
      })
  }

  const handleSubmit = async (): Promise<void> => {
    const slice = currentSlice
    if (slice.view !== 'form' || slice.status === 'submitting') return
    deps.dispatch({ type: 'submit' })
    if (slice.repoSelector === null) {
      deps.dispatch({ type: 'submit-error', message: plainFailure(t('spawn.repoUnresolved')) })
      return
    }
    const clientMutationId = generateMutationId()
    const fields =
      slice.fields.name.trim() === ''
        ? { ...slice.fields, name: generatedWorktreeName(clientMutationId) }
        : slice.fields
    const input = {
      ...toCreateWorktreeInput(fields, slice.parentId, slice.repoSelector),
      clientMutationId
    }
    try {
      const { worktreeId } = await gateway.createWorktree(input)
      deps.dispatch({ type: 'submit-ok' })
      await deps.refetch()
      deps.selectCreated?.(worktreeId)
    } catch (error) {
      deps.dispatch({ type: 'submit-error', message: describeFailure('spawnCreate', error) })
    }
  }

  const controller: SpawnMenuController = {
    sync(spawnMenu: SpawnMenuSlice, graph: WorktreeGraph): void {
      const generation = ++syncGeneration
      currentSlice = spawnMenu
      currentGraph = graph
      maybeFetchRepoSelector(spawnMenu, graph)
      // A re-entrant dispatch above already re-synced with the newer slice.
      if (generation !== syncGeneration) return
      if (spawnMenu.view === 'form') setupHints.ensure(spawnMenu.repoSelector)
      else if (spawnMenu.view === 'closed') setupHints.reset()
      const model = spawnViewModel(
        spawnMenu,
        graph,
        spawnMenu.view === 'form' ? setupHints.hint(spawnMenu.repoSelector) : null
      )
      if (model === null) {
        unmountMenu()
        unmountForm()
        return
      }
      if (model.view === 'radial') {
        unmountForm()
        currentNodeId = spawnMenu.view === 'radial' ? spawnMenu.nodeId : null
        mountMenu().apply(model)
        return
      }
      unmountMenu()
      mountForm().apply(model)
    },
    tick(): void {
      if (!menu || currentNodeId === null) return
      const center = deps.nodeCenter(currentNodeId)
      if (!center) return
      menu.object.position.set(center.x, center.y, center.z)
      // Why: a zoomed-in cube (`f`) is far wider than the CSS default gap, and chips would cover it.
      const rect = deps.cubeRect?.(currentNodeId)
      menu.setClearance(
        rect
          ? Math.max(RADIAL_MIN_CLEARANCE_PX, (rect.right - rect.left) / 2 + RADIAL_CUBE_GAP)
          : null
      )
    },
    rebindGateway(newGateway: SpawnGatewayPort): void {
      gateway = newGateway
      setupHints.reset()
    },
    dispose(): void {
      unmountMenu()
      unmountForm()
    }
  }
  return controller
}
