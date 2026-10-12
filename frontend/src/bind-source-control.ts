import { createSourceControlFlow } from './application/source-control-flow'
import type { SourceControlGatewayPort } from './application/source-control-flow'
import type { SceneStore } from './application/scene-store'
import type { DiffViewBinder } from './bind-diff-view'
import { createSourceControlComposer } from './presentation/diff/source-control-composer-element'
import type { SourceControlComposerHandle } from './presentation/diff/source-control-composer-element'
import { sourceControlModel } from './presentation/diff/source-control-view-model'

export type SourceControlBinder = {
  /** Follows diff mode: loads status when it opens on a node, drops it when it closes. */
  sync(): void
  /** Re-reads status in place, e.g. after a file edit changed the tree. */
  reload(): void
  rebindGateway(gateway: SourceControlGatewayPort): void
}

/** Extracted out of main.ts (max-lines ratchet): wires the commit composer and rail stage toggles to diff mode. */
export function createSourceControlBinder(deps: {
  store: SceneStore
  slot: { appendChild(element: unknown): void }
  demoGateway: SourceControlGatewayPort
  diff: Pick<DiffViewBinder, 'refresh' | 'sync' | 'attachStageSource'>
  createComposer?: () => SourceControlComposerHandle
}): SourceControlBinder {
  let composer: SourceControlComposerHandle | null = null
  let openFor: string | null = null
  const flow = createSourceControlFlow({
    store: deps.store,
    gateway: deps.demoGateway,
    refreshDiff: () => deps.diff.refresh()
  })

  deps.diff.attachStageSource({
    stageStates() {
      const view = flow.view()
      return view.phase === 'ready' ? view.stageStates : undefined
    },
    toggle: (path) => void flow.toggleStage(path),
    refreshStatus: () => void flow.refreshStatus()
  })

  flow.subscribe((view) => {
    if (view.phase === 'hidden') {
      composer?.dispose()
      composer = null
    } else {
      if (!composer) {
        composer = (deps.createComposer ?? createSourceControlComposer)()
        composer.onMessageChange((message) => flow.setMessage(message))
        composer.onCommit(() => void flow.commit())
        composer.onPush(() => void flow.push())
        composer.onReviewForm((form) => flow.setReviewForm(form))
        composer.onReviewPrimary(() => void flow.reviewPrimary())
        deps.slot.appendChild(composer.root)
      }
      composer.apply(sourceControlModel(view))
    }
    deps.diff.sync()
  })

  return {
    sync() {
      const { diffView } = deps.store.get()
      const nodeId = diffView.view === 'open' ? diffView.focusedNodeId : null
      if (nodeId === openFor) return
      openFor = nodeId
      if (nodeId === null) flow.close()
      else void flow.open(nodeId)
    },
    reload() {
      void flow.reload()
    },
    rebindGateway(gateway) {
      flow.rebindGateway(gateway)
    }
  }
}
