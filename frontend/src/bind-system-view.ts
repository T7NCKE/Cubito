import { createSystemViewController } from './presentation/system/system-view-controller'
import { createSystemGraph } from './presentation/system/system-graph-element'
import { createActivityFeed } from './presentation/system/activity-feed-element'
import { createSystemHud } from './presentation/system/system-hud-element'
import { createSystemLiveDriver } from './application/system-live-driver'
import { createSystemGraphSource } from './application/system-graph-source'
import type { SystemSnapshotPollGatewayPort } from './application/system-snapshot-poll'
import { createAgentActivityPoll } from './application/agent-activity-poll'
import type { AgentActivityPollGatewayPort } from './application/agent-activity-poll'
import type { SceneStore } from './application/scene-store'
import type { SystemGraphPort } from './application/ports/system-graph-port'
import type { SystemGraphStreamPort } from './application/ports/system-graph-stream-port'
import type { SystemGraphHandle } from './presentation/system/system-graph-element'
import type { ActivityFeedHandle } from './presentation/system/activity-feed-element'
import type { SystemHudHandle } from './presentation/system/system-hud-element'

/** Both live-gateway ports the system view drives — the snapshot poll and the activity poll. */
export type SystemViewGatewayPort = SystemSnapshotPollGatewayPort & AgentActivityPollGatewayPort

export type BindSystemViewDeps = {
  store: SceneStore
  systemSlot: { appendChild(element: unknown): void }
  /** The `#system-graph-viewport` scrollable slot (Change item 4) the graph mounts into. */
  graphSlot: { appendChild(element: unknown): void }
  keyboardBarSlot: { appendChild(element: unknown): void }
  demoGraphPort: SystemGraphPort
  demoGateway: SystemViewGatewayPort
  /** DOM element factory overrides — tests substitute fakes, production uses the defaults. */
  createGraph?: () => SystemGraphHandle
  createFeed?: () => ActivityFeedHandle
  createHud?: () => SystemHudHandle
}

export type SystemViewBinder = {
  sync(): void
  rebindGateway(gateway: SystemViewGatewayPort, streamPort?: SystemGraphStreamPort): void
}

/**
 * Extracted out of main.ts (max-lines ratchet, mirrors bind-fan-out.ts): builds the system-view
 * controller + BOTH drivers once — the scripted stub (`createSystemLiveDriver` over
 * `demoGraphPort`, untouched fallback path) and the real gateway-backed poll
 * (`createSystemSnapshotPoll`) — starting/stopping the right one on the systemView open/close
 * transition (detected by comparing against the previous sync's view). Worktree-chrome
 * hide/show is owned by main.ts's subscribe loop (order-independent with bind-diff-view.ts), not
 * by onEnter/onExit here — keeping only the DOM-scoped #system mount/unmount lifecycle.
 */
export function createSystemViewBinder(deps: BindSystemViewDeps): SystemViewBinder {
  const controller = createSystemViewController({
    createGraph: deps.createGraph ?? createSystemGraph,
    createFeed: deps.createFeed ?? createActivityFeed,
    createHud: deps.createHud ?? createSystemHud,
    hud: deps.systemSlot,
    graphSlot: deps.graphSlot,
    keyboardBarSlot: deps.keyboardBarSlot
  })
  const driver = createSystemLiveDriver({ store: deps.store, port: deps.demoGraphPort })

  // Set once a real connection rebinds the source's gateway; stays true across later opens/closes
  // (mirrors DiffViewBinder — no "unbind" on disconnect), so `pnpm dev` offline stays on the
  // stub path with no gateway ever set.
  let hasRealGateway = false
  const source = createSystemGraphSource({
    store: deps.store,
    gateway: deps.demoGateway,
    onDemoFallback: () => {
      // old host, no `system.snapshot` either — fall back to the scripted demo for this open.
      const systemView = deps.store.get().systemView
      if (systemView.view === 'open') driver.start(systemView.focusedNodeId)
    }
  })
  const activityPoll = createAgentActivityPoll({
    store: deps.store,
    gateway: deps.demoGateway,
    // old host, no `agent.activity` — the placeholder feed stays; the snapshot poll/graph is
    // unaffected, so no fallback to the scripted driver here (that's the snapshot poll's job).
    onUnsupported: () => {}
  })

  let wasOpen = false

  return {
    sync(): void {
      const state = deps.store.get()
      const { systemView } = state
      const isOpen = systemView.view === 'open'
      const transitionToOpen = isOpen && !wasOpen
      const transitionToClosed = !isOpen && wasOpen
      wasOpen = isOpen
      // start() re-dispatches 'open' (harmless — nothing has run yet at this instant), which
      // re-enters sync() synchronously; wasOpen is already updated above, so it won't recurse.
      if (transitionToOpen && systemView.view === 'open') {
        // per-open attempt (not a one-time probe) — a later open retries the real gateway even
        // if an earlier one fell back, so a since-upgraded host is picked up automatically.
        if (hasRealGateway) {
          source.start(systemView.focusedNodeId)
          activityPoll.start(systemView.focusedNodeId)
        } else {
          driver.start(systemView.focusedNodeId)
        }
      }
      if (transitionToClosed) {
        source.stop()
        activityPoll.stop()
        driver.stop()
      }

      const selectedId = state.selection.selectedId
      const branchLabel =
        selectedId !== null ? (state.graph.nodes.get(selectedId)?.branch ?? '') : ''
      // Offline (no real gateway ever bound) always runs the scripted driver — the source itself
      // never starts, so its own currentSource() would report a meaningless default.
      const sourceKind = hasRealGateway ? source.currentSource() : 'demo'
      // The scripted demo always plays an agent; a live view needs the node's agent to be busy.
      const agentActive =
        sourceKind === 'demo' ||
        (selectedId !== null &&
          (state.graph.nodes.get(selectedId)?.activity.agentStatus ?? 'idle') !== 'idle')
      controller.sync(
        deps.store.get().systemView,
        state.connection,
        branchLabel,
        sourceKind,
        agentActive
      )
    },
    rebindGateway(gateway: SystemViewGatewayPort, streamPort?: SystemGraphStreamPort): void {
      hasRealGateway = true
      source.rebind(gateway, streamPort)
      activityPoll.rebindGateway(gateway)
    }
  }
}
