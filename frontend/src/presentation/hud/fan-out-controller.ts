import type { WorktreeGraph, WorktreeId } from '../../domain/worktree-graph/types'
import { describeFailure, plainFailure } from '../../application/i18n/user-facing-error'
import {
  fanOutRepoUnresolvedMessage,
  emptyFanOutSlice,
  fanOutMemberIds,
  fanOutSubmitBlocker,
  reduceFanOut,
  toFanOutInputs
} from '../../application/fan-out-model'
import type { FanOutAction, FanOutSlice } from '../../application/fan-out-model'
import { repoSelectorForNode } from '../../application/anchor-repo-selector'
import type { CreateWorktreeInput, RuntimeGateway } from '../../application/ports/runtime-gateway'
import type { CamadaMemberPoll } from '../../application/camada-member-poll'
import { runCamadaLeaseSubmit } from '../../application/fan-out-lease-submit'
import type { FanOutFormHandle } from './fan-out-element'
import { createSetupHintTracker } from '../../application/repo-setup-hint'
import { repoSetupSaved } from '../../application/repo-setup-saved'
import { fanOutPanelVisible, fanOutViewModel } from './fan-out-view-model'

/** listRepos/createWorktree/listWorktreePs for the v1 loop and the member poll it owns, plus
 *  the 3 lease verbs the Change B path calls — one port satisfies both, so rebindGateway can
 *  hand the same object to the member poll and the lease planner alike. */
export type FanOutGatewayPort = Pick<
  RuntimeGateway,
  | 'listRepos'
  | 'createWorktree'
  | 'listWorktreePs'
  | 'repoSetupCommand'
  | 'orchestrationRunCreate'
  | 'orchestrationTaskCreate'
  | 'orchestrationWorkerStart'
  | 'orchestrationWorkerList'
  | 'orchestrationWorkerShow'
  | 'orchestrationGateList'
  | 'orchestrationGateResolve'
  | 'orchestrationQuestionList'
  | 'orchestrationQuestionAnswer'
>

export type FanOutControllerDeps = {
  gateway: FanOutGatewayPort
  createElement: () => FanOutFormHandle
  hud: { appendChild(element: unknown): void }
  dispatch: (action: FanOutAction) => void
  /** Frames the camera on the litter (parent + created children) — mirrors focusIsland. */
  focusLitter: (memberIds: readonly WorktreeId[]) => void
  /** Started after a successful (or partially successful) submit, stopped on close/cancel. */
  memberPoll: CamadaMemberPoll
  /** Fired after the batch settles — snappier than waiting for the live-sync poll. */
  refetch: () => Promise<void>
  /** Injectable for deterministic tests; defaults to the real UUID generator. */
  generateMutationId?: () => string
  /** Repos slice's active repo (mirrors spawn-menu-controller) — preferred over `repos[0]`. */
  activeRepoId?: () => string | null
  /** True when the paired host announced the lease capability (Change B); defaults to v1-only. */
  leaseCapable?: () => boolean
  /** Injectable for deterministic tests; defaults to the real lease-run planner. */
  leasePlanner?: typeof runCamadaLeaseSubmit
}

export type FanOutController = {
  sync(fanOut: FanOutSlice, graph: WorktreeGraph): void
  rebindGateway(gateway: FanOutGatewayPort): void
  dispose(): void
}

/**
 * Owns the fan-out form/running lifecycle, mirroring spawn-menu-controller.ts: mounts the HUD
 * element as `fanOut.view` moves away from 'closed', resolves the repo selector once per open,
 * and drives the sequential `createWorktree` batch on submit.
 */
export function createFanOutController(deps: FanOutControllerDeps): FanOutController {
  let gateway = deps.gateway
  let element: FanOutFormHandle | null = null
  let currentSlice: FanOutSlice = emptyFanOutSlice()
  let currentGraph: WorktreeGraph | null = null
  let previousView: FanOutSlice['view'] = 'closed'
  let repoFetchInFlight = false
  let syncGeneration = 0
  // UI-only: dismissing the running panel hides it without ending the litter (compare needs it).
  let dismissed = false

  const setupHints = createSetupHintTracker({
    probe: (repoSelector) => gateway.repoSetupCommand(repoSelector),
    invalidations: repoSetupSaved,
    onChange: () => {
      if (currentGraph) controller.sync(currentSlice, currentGraph)
    }
  })

  const generateMutationId = deps.generateMutationId ?? (() => crypto.randomUUID())
  const activeRepoId = deps.activeRepoId ?? (() => null)
  const leaseCapable = deps.leaseCapable ?? (() => false)
  const leasePlanner = deps.leasePlanner ?? runCamadaLeaseSubmit

  const unmount = (): void => {
    if (!element) return
    element.dispose()
    element = null
  }

  // Both are called from the gate-list row's own submit — it awaits the returned promise and
  // shows a rejection inline on that row (non-destructive: no dispatch, panel stays mounted).
  // A resolved/answered id simply stops coming back from the poll's decisionVisibility next
  // tick, so no local reducer action is needed here (design pin 8/Open Q1: poll-refresh only).
  const handleResolveGate = async (gateId: string, resolution: string): Promise<void> => {
    if (currentSlice.view !== 'running' || currentSlice.runId === null) return
    await gateway.orchestrationGateResolve({ run: currentSlice.runId, gateId, resolution })
    await deps.refetch()
  }

  const handleAnswerQuestion = async (messageId: string, body: string): Promise<void> => {
    if (currentSlice.view !== 'running' || currentSlice.runId === null) return
    await gateway.orchestrationQuestionAnswer({ run: currentSlice.runId, messageId, body })
    await deps.refetch()
  }

  const mount = (): FanOutFormHandle => {
    if (!element) {
      const created = deps.createElement()
      created.onCountChange((count) => deps.dispatch({ type: 'update-count', count }))
      created.onAgentChange((agent) => deps.dispatch({ type: 'update-agent', agent }))
      created.onPromptChange((prompt) => deps.dispatch({ type: 'update-prompt', prompt }))
      created.onSubmit(() => void handleSubmit())
      created.onCancel(() => deps.dispatch({ type: 'cancel' }))
      created.onDismiss(() => {
        dismissed = true
        if (currentGraph) controller.sync(currentSlice, currentGraph)
      })
      created.onResolveGate((gateId, resolution) => handleResolveGate(gateId, resolution))
      created.onAnswerQuestion((messageId, body) => handleAnswerQuestion(messageId, body))
      deps.hud.appendChild(created.element)
      element = created
    }
    return element
  }

  // The litter lands in the PARENT's repo, derived from the graph every sync (a selector cached
  // from an earlier open on another repo never leaks); listRepos is only the no-graph fallback.
  const maybeFetchRepoSelector = (slice: FanOutSlice, graph: WorktreeGraph): void => {
    if (slice.view === 'closed') return
    const anchored = repoSelectorForNode(graph, slice.parentId)
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

  // v1 worktree-only loop (design camada, pre-lease): sequential createWorktree, continue-on-error.
  // Shared by the plain v1 path and the lease path's runCreate-failure fallback.
  const runV1Batch = async (
    inputs: readonly CreateWorktreeInput[],
    mutationIds: readonly string[],
    startSlice: FanOutSlice
  ): Promise<FanOutSlice> => {
    let localSlice = startSlice
    for (let i = 0; i < mutationIds.length; i++) {
      const mutationId = mutationIds[i]!
      try {
        const result = await gateway.createWorktree(inputs[i]!)
        localSlice = reduceFanOut(localSlice, {
          type: 'child-created',
          mutationId,
          worktreeId: result.worktreeId
        })
        deps.dispatch({ type: 'child-created', mutationId, worktreeId: result.worktreeId })
      } catch (err) {
        const message = describeFailure('fanOutChild', err)
        localSlice = reduceFanOut(localSlice, { type: 'child-failed', mutationId, message })
        deps.dispatch({ type: 'child-failed', mutationId, message })
      }
    }
    return localSlice
  }

  const handleSubmit = async (): Promise<void> => {
    const slice = currentSlice
    if (slice.view !== 'form') return
    const blocker = fanOutSubmitBlocker(slice)
    // The explicit null re-check only narrows repoSelector for TS; the blocker already rejects it.
    if (blocker !== null || slice.repoSelector === null) {
      deps.dispatch({
        type: 'form-error',
        message: plainFailure(blocker ?? fanOutRepoUnresolvedMessage())
      })
      return
    }
    const repoSelector = slice.repoSelector
    const mutationIds = Array.from({ length: slice.fields.count }, () => generateMutationId())
    deps.dispatch({ type: 'submit', mutationIds })

    // Local mirror of the reducer transition — lets the loop compute member ids for the camera
    // and poll start without depending on the store round-tripping through sync() mid-flight.
    let localSlice: FanOutSlice

    if (leaseCapable() && slice.fields.agent !== 'none') {
      const leaseResult = await leasePlanner(slice, repoSelector, mutationIds, {
        gateway,
        dispatch: deps.dispatch
      })
      localSlice = leaseResult.localSlice
      if (leaseResult.runCreateFailed) {
        const inputs = toFanOutInputs(slice, repoSelector, mutationIds)
        localSlice = await runV1Batch(inputs, mutationIds, localSlice)
      }
    } else {
      localSlice = reduceFanOut(slice, { type: 'submit', mutationIds })
      const inputs = toFanOutInputs(slice, repoSelector, mutationIds)
      localSlice = await runV1Batch(inputs, mutationIds, localSlice)
    }

    deps.focusLitter(fanOutMemberIds(localSlice))
    deps.memberPoll.start()
    await deps.refetch()
  }

  const controller: FanOutController = {
    sync(fanOut: FanOutSlice, graph: WorktreeGraph): void {
      const generation = ++syncGeneration
      currentSlice = fanOut
      currentGraph = graph
      maybeFetchRepoSelector(fanOut, graph)
      // A re-entrant dispatch above already re-synced with the newer slice.
      if (generation !== syncGeneration) return
      if (fanOut.view === 'closed') {
        unmount()
        setupHints.reset()
        deps.memberPoll.stop()
        previousView = 'closed'
        dismissed = false
        return
      }
      if (fanOut.view !== 'running') dismissed = false
      if (fanOut.view === 'form') setupHints.ensure(fanOut.repoSelector)
      const model = fanOutViewModel(
        fanOut,
        fanOut.view === 'form' ? setupHints.hint(fanOut.repoSelector) : null,
        graph
      )
      const mounted = mount()
      if (model !== null) mounted.apply(model)
      mounted.setVisible(fanOutPanelVisible(fanOut, graph, activeRepoId(), dismissed))
      // display:none force-blurs a focused descendant, mirroring project-selector's focusPath()
      // and spawn-form's focusFirstField() fix on the closed -> form transition.
      if (previousView === 'closed' && fanOut.view === 'form') mounted.focusFirstField()
      previousView = fanOut.view
    },
    rebindGateway(newGateway: FanOutGatewayPort): void {
      gateway = newGateway
      setupHints.reset()
      deps.memberPoll.rebindGateway(newGateway)
    },
    dispose(): void {
      unmount()
      deps.memberPoll.stop()
    }
  }
  return controller
}
