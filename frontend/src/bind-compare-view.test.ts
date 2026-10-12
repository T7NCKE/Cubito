import { describe, expect, it } from 'vitest'
import { createCompareViewBinder } from './bind-compare-view'
import type { BindCompareViewDeps } from './bind-compare-view'
import { createSceneStore } from './application/scene-store'
import type { WorktreeId } from './domain/worktree-graph/types'
import type { CompareRailHandle } from './presentation/compare/compare-rail-element'
import type { CompareHudHandle } from './presentation/compare/compare-hud-element'
import type { CompareMergeActionHandle } from './presentation/compare/compare-merge-action-element'
import type { DiffRailHandle } from './presentation/diff/diff-rail-element'
import type { DiffPanelHandle } from './presentation/diff/diff-panel-element'

const fakeChildRail = (): CompareRailHandle => ({
  root: {} as HTMLElement,
  apply() {},
  onFocusChild() {},
  onSetWinner() {},
  dispose() {}
})

const fakeFileRail = (): DiffRailHandle => ({
  root: {} as HTMLElement,
  apply() {},
  onSelect() {},
  onStageToggle() {},
  dispose() {}
})

const fakePanel = (): DiffPanelHandle => ({
  element: {} as HTMLElement,
  apply() {},
  dispose() {}
})

const fakeHud = (): CompareHudHandle => ({
  root: {} as HTMLElement,
  keyboardBar: { root: {} as HTMLElement, apply() {}, dispose() {} },
  apply() {},
  dispose() {}
})

const fakeMergeAction = (): CompareMergeActionHandle => ({
  root: {} as HTMLElement,
  apply() {},
  onMergeWinner() {},
  dispose() {}
})

type FakeHeights = {
  goToCamadaCalls: (readonly WorktreeId[])[]
  refitCamadaCalls: (readonly WorktreeId[])[]
  popCalls: number
  goToCamadaReturns: boolean
  goToCamada(memberIds: readonly WorktreeId[]): boolean
  refitCamada(memberIds: readonly WorktreeId[]): void
  pop(): boolean
}

const createFakeHeights = (goToCamadaReturns = true): FakeHeights => ({
  goToCamadaCalls: [],
  refitCamadaCalls: [],
  popCalls: 0,
  goToCamadaReturns,
  goToCamada(memberIds) {
    this.goToCamadaCalls.push(memberIds)
    return this.goToCamadaReturns
  },
  refitCamada(memberIds) {
    this.refitCamadaCalls.push(memberIds)
  },
  pop() {
    this.popCalls++
    return true
  }
})

function setup(heights: FakeHeights) {
  const store = createSceneStore()
  const deps: BindCompareViewDeps = {
    store,
    compareSlot: { appendChild() {} },
    keyboardBarSlot: { appendChild() {} },
    demoGateway: {
      gitBranchCompare: async () => {
        throw new Error('not stubbed for this test')
      },
      gitBranchDiff: async () => {
        throw new Error('not stubbed for this test')
      },
      gitMergeWinnerIntoParent: async () => {
        throw new Error('not stubbed for this test')
      }
    },
    heights,
    createChildRail: fakeChildRail,
    createFileRail: fakeFileRail,
    createPanel: fakePanel,
    createHud: fakeHud,
    createMergeAction: fakeMergeAction
  }
  const binder = createCompareViewBinder(deps)
  return { store, binder }
}

/** Drives fan-out-model's real reducer to a 'running' slice with a real parentId, then opens
 *  compare on the given members — camadaIds prepends this parent (design D2/C6). */
function withRunningCamadaAndOpenCompare(
  store: ReturnType<typeof createSceneStore>,
  parentId: string,
  members: readonly string[]
): void {
  store.dispatchFanOut({ type: 'open-for-node', nodeId: parentId })
  store.dispatchFanOut({ type: 'set-repo-selector', repoSelector: 'id:repo-a' })
  const mutationIds = members.map((_, i) => `m${i}`)
  store.dispatchFanOut({ type: 'submit', mutationIds })
  mutationIds.forEach((mutationId, i) => {
    store.dispatchFanOut({ type: 'child-created', mutationId, worktreeId: members[i]! })
  })
  store.dispatchCompareView({ type: 'open', members })
}

describe('createCompareViewBinder — camera height push/pop', () => {
  it('the open transition starts the loader and frames the camada, parent first', () => {
    const heights = createFakeHeights()
    const { store, binder } = setup(heights)

    withRunningCamadaAndOpenCompare(store, 'root', ['w1', 'w2'])
    binder.sync()

    expect(heights.goToCamadaCalls).toEqual([['root', 'w1', 'w2']])
  })

  it('the close transition stops the loader and pops', () => {
    const heights = createFakeHeights()
    const { store, binder } = setup(heights)

    withRunningCamadaAndOpenCompare(store, 'root', ['w1'])
    binder.sync()
    store.dispatchCompareView({ type: 'close' })
    binder.sync()

    expect(heights.popCalls).toBe(1)
  })

  it('a close with nothing pushed does not pop', () => {
    const heights = createFakeHeights(false)
    const { store, binder } = setup(heights)

    withRunningCamadaAndOpenCompare(store, 'root', ['w1'])
    binder.sync()
    store.dispatchCompareView({ type: 'close' })
    binder.sync()

    expect(heights.popCalls).toBe(0)
  })

  it('repeated syncs while open frame exactly once', () => {
    const heights = createFakeHeights()
    const { store, binder } = setup(heights)

    withRunningCamadaAndOpenCompare(store, 'root', ['w1'])
    binder.sync()
    binder.sync()
    binder.sync()

    expect(heights.goToCamadaCalls).toHaveLength(1)
  })
})

describe('createCompareViewBinder — litter follows the fan-out live', () => {
  it('adds a child spawned after open, loads it and refits the camada', () => {
    const heights = createFakeHeights()
    const { store, binder } = setup(heights)
    store.dispatchFanOut({ type: 'open-for-node', nodeId: 'root' })
    store.dispatchFanOut({ type: 'set-repo-selector', repoSelector: 'id:repo-a' })
    store.dispatchFanOut({ type: 'submit', mutationIds: ['m0', 'm1', 'm2'] })
    store.dispatchFanOut({ type: 'child-created', mutationId: 'm0', worktreeId: 'w1' })
    store.dispatchFanOut({ type: 'child-created', mutationId: 'm1', worktreeId: 'w2' })
    store.dispatchCompareView({ type: 'open', members: ['w1', 'w2'] })
    binder.sync()

    store.dispatchFanOut({ type: 'child-created', mutationId: 'm2', worktreeId: 'w3' })
    binder.sync()

    const slice = store.get().compareView
    expect(slice.view === 'open' && slice.members).toEqual(['w1', 'w2', 'w3'])
    expect(slice.view === 'open' && slice.focusedChildId).toBe('w1')
    expect(heights.refitCamadaCalls.at(-1)).toEqual(['root', 'w1', 'w2', 'w3'])
  })
})

describe('createCompareViewBinder — onViewportResize (design D8/risk 6)', () => {
  it('refits while open after a push', () => {
    const heights = createFakeHeights()
    const { store, binder } = setup(heights)
    withRunningCamadaAndOpenCompare(store, 'root', ['w1', 'w2'])
    binder.sync()

    binder.onViewportResize()

    expect(heights.refitCamadaCalls).toEqual([['root', 'w1', 'w2']])
  })

  it('is a no-op before the push (the open-edge refit trap, risk 6)', () => {
    const heights = createFakeHeights()
    const { store, binder } = setup(heights)
    withRunningCamadaAndOpenCompare(store, 'root', ['w1'])
    // binder.sync() deliberately NOT called yet — goToCamada has not captured the pre-compare pose

    binder.onViewportResize()

    expect(heights.refitCamadaCalls).toHaveLength(0)
  })

  it('is a no-op once the slice is closed', () => {
    const heights = createFakeHeights()
    const { store, binder } = setup(heights)
    withRunningCamadaAndOpenCompare(store, 'root', ['w1'])
    binder.sync()
    store.dispatchCompareView({ type: 'close' })
    binder.sync()

    binder.onViewportResize()

    expect(heights.refitCamadaCalls).toHaveLength(0)
  })
})
