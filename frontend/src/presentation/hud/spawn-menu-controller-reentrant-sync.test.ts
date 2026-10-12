import { describe, expect, it, vi } from 'vitest'
import { createSpawnMenuController } from './spawn-menu-controller'
import type { SpawnMenuControllerDeps } from './spawn-menu-controller'
import { createSceneStore } from '../../application/scene-store'
import { emptyWorktreeGraph } from '../../domain/worktree-graph/types'
import type { WorktreeGraph, WorktreeNode } from '../../domain/worktree-graph/types'
import { inertActivity } from '../../domain/worktree-graph/node-activity'
import type { SpawnMenuHandle } from './spawn-menu-element'
import type { SpawnFormHandle } from './spawn-form-element'

/** Sibling of spawn-menu-controller.test.ts — the real-store re-entrant sync regression
 *  (mirrors fan-out-controller-reentrant-sync.test.ts) gets its own file. */

const nodeIn = (id: string, repoId: string): WorktreeNode => ({
  id,
  repoId,
  branch: 'refs/heads/master',
  path: `/${id}`,
  status: 'clean',
  isMain: true,
  kind: 'root',
  parentId: null,
  childIds: [],
  activity: inertActivity()
})

const graphOf = (...nodes: WorktreeNode[]): WorktreeGraph => ({
  ...emptyWorktreeGraph(),
  nodes: new Map(nodes.map((n) => [n.id, n])),
  rootIds: nodes.map((n) => n.id)
})

type FakeMenu = SpawnMenuHandle & { applyCalls: number }

const createFakeMenu = (): FakeMenu => {
  const menu: FakeMenu = {
    object: { position: { set: vi.fn() } } as unknown as SpawnMenuHandle['object'],
    applyCalls: 0,
    apply: () => menu.applyCalls++,
    setClearance: vi.fn(),
    dispose: vi.fn()
  }
  return menu
}

const createFakeForm = (): SpawnFormHandle => ({
  element: {} as HTMLElement,
  apply: vi.fn(),
  onFieldChange: () => () => {},
  onSubmit: () => () => {},
  onCancel: () => () => {},
  focusFirstField: vi.fn(),
  dispose: vi.fn()
})

function setup(menus: FakeMenu[]) {
  const store = createSceneStore()
  const gateway: SpawnMenuControllerDeps['gateway'] = {
    listRepos: vi.fn(async () => []),
    createWorktree: vi.fn(),
    repoSetupCommand: vi.fn(async () => 'pnpm install')
  }
  const controller = createSpawnMenuController({
    gateway,
    createMenu: () => {
      const m = createFakeMenu()
      menus.push(m)
      return m
    },
    createForm: createFakeForm,
    labelLayer: { add: vi.fn(), remove: vi.fn() },
    hud: { appendChild: vi.fn() },
    dispatch: (action) => store.dispatchSpawn(action),
    nodeCenter: vi.fn(() => null),
    refetch: async () => {}
  })
  store.subscribe((s) => controller.sync(s.spawnMenu, s.graph))
  return { store, controller }
}

describe('spawn-menu re-entrant sync (real store)', () => {
  it('open-for-node on an anchored node applies the radial menu exactly once', () => {
    const menus: FakeMenu[] = []
    const { store } = setup(menus)
    store.update({ graph: graphOf(nodeIn('w1', 'repo-1')) })

    store.dispatchSpawn({ type: 'open-for-node', nodeId: 'w1' })

    expect(menus).toHaveLength(1)
    expect(menus[0]!.applyCalls).toBe(1)
  })

  it('opening on a node of another repo after close still applies the new menu exactly once', () => {
    const menus: FakeMenu[] = []
    const { store } = setup(menus)
    store.update({ graph: graphOf(nodeIn('w1', 'repo-1'), nodeIn('w2', 'repo-2')) })
    store.dispatchSpawn({ type: 'open-for-node', nodeId: 'w1' })
    store.dispatchSpawn({ type: 'cancel' })

    store.dispatchSpawn({ type: 'open-for-node', nodeId: 'w2' })

    expect(menus).toHaveLength(2)
    expect(menus[1]!.applyCalls).toBe(1)
  })
})
