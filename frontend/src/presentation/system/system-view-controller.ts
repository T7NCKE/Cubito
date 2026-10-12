import type { ConnectionState } from '../../application/scene-store'
import { systemHudCounts } from '../../application/system-view-model'
import type { SystemViewSlice } from '../../application/system-view-model'
import type { SystemGraphSourceKind } from '../../application/system-graph-source'
import { systemGraphViewModel } from './system-graph-model'
import { activityFeedViewModel } from './activity-feed-model'
import type { SystemGraphHandle } from './system-graph-element'
import type { ActivityFeedHandle } from './activity-feed-element'
import type { SystemHudHandle } from './system-hud-element'

export type SystemViewControllerDeps = {
  createGraph: () => SystemGraphHandle
  createFeed: () => ActivityFeedHandle
  createHud: () => SystemHudHandle
  /** The `#system` slot — this controller mounts/unmounts into it and nothing else DOM-wise. */
  hud: { appendChild(element: unknown): void }
  /** The `#system-graph-viewport` scrollable slot (Change item 4) — the graph mounts here
   *  instead of `hud`, so a narrow window scrolls the graph instead of shrinking its text. */
  graphSlot: { appendChild(element: unknown): void }
  /** Shared `#keyboard-bar` slot the worktree HUD's own bar already occupies. */
  keyboardBarSlot: { appendChild(element: unknown): void }
  /** Fires once on the closed->open transition, after mounting — the seam for hiding the
   *  worktree HUD/keyboard-bar/3D scene, keeping this controller DOM-scoped to #system. */
  onEnter?: () => void
  /** Fires once on the open->closed transition, after unmounting — restores worktree chrome. */
  onExit?: () => void
}

export type SystemViewController = {
  sync(
    systemView: SystemViewSlice,
    connection: ConnectionState,
    branchLabel: string,
    source: SystemGraphSourceKind,
    agentActive?: boolean
  ): void
  dispose(): void
}

type Mounted = { graph: SystemGraphHandle; feed: ActivityFeedHandle; hud: SystemHudHandle }

/**
 * Mirrors terminal-panel-controller's mount/unmount-on-slice-transition lifecycle for the
 * "sistema en vivo" full-screen view. Drives nothing about the live driver itself —
 * bind-system-view.ts starts/stops that alongside this controller's sync.
 */
export function createSystemViewController(deps: SystemViewControllerDeps): SystemViewController {
  let mounted: Mounted | null = null

  const mount = (): Mounted => {
    const graph = deps.createGraph()
    const feed = deps.createFeed()
    const hud = deps.createHud()
    deps.hud.appendChild(hud.root)
    deps.graphSlot.appendChild(graph.element)
    deps.hud.appendChild(feed.element)
    deps.keyboardBarSlot.appendChild(hud.keyboardBar.root)
    const entry: Mounted = { graph, feed, hud }
    mounted = entry
    return entry
  }

  const unmount = (): void => {
    if (!mounted) return
    mounted.graph.dispose()
    mounted.feed.dispose()
    mounted.hud.dispose()
    mounted = null
  }

  return {
    sync(systemView, connection, branchLabel, source, agentActive = true) {
      if (systemView.view !== 'open') {
        if (mounted) {
          unmount()
          deps.onExit?.()
        }
        return
      }
      const enteringNow = !mounted
      const entry = mounted ?? mount()
      if (enteringNow) deps.onEnter?.()
      entry.graph.apply(systemGraphViewModel(systemView.graph, systemView.highlightedNodeId))
      entry.feed.apply(activityFeedViewModel(systemView.feed))
      entry.hud.apply({
        connection,
        branch: branchLabel,
        counts: systemHudCounts(systemView),
        source,
        agentActive
      })
    },
    dispose(): void {
      unmount()
    }
  }
}
