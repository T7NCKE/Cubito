import { describe, expect, it, vi } from 'vitest'
import { createSpawnMenuController } from './spawn-menu-controller'
import type { SpawnMenuControllerDeps } from './spawn-menu-controller'
import { emptySpawnMenuSlice, reduceSpawnMenu } from '../../application/spawn-menu-model'
import type { SpawnMenuAction, SpawnMenuSlice } from '../../application/spawn-menu-model'
import type {
  CreateWorktreeInput,
  CreateWorktreeResult,
  RepoSummary
} from '../../application/ports/runtime-gateway'
import type { SpawnMenuHandle } from './spawn-menu-element'
import type { SpawnFormHandle, SpawnFormField } from './spawn-form-element'
import { emptyWorktreeGraph } from '../../domain/worktree-graph/types'
import type { WorktreeGraph, WorktreeNode } from '../../domain/worktree-graph/types'
import { inertActivity } from '../../domain/worktree-graph/node-activity'

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

type FakeMenu = SpawnMenuHandle & { applyCalls: number; disposed: boolean }

const createFakeMenu = (): FakeMenu => {
  const menu: FakeMenu = {
    object: { position: { set: vi.fn() } } as unknown as SpawnMenuHandle['object'],
    applyCalls: 0,
    disposed: false,
    apply: vi.fn(() => menu.applyCalls++),
    dispose: vi.fn(() => (menu.disposed = true))
  }
  return menu
}

type FakeForm = SpawnFormHandle & {
  disposed: boolean
  emitFieldChange(field: SpawnFormField, value: string): void
  emitSubmit(): void
  emitCancel(): void
}

const createFakeForm = (): FakeForm => {
  let fieldCb: ((field: SpawnFormField, value: string) => void) | null = null
  let submitCb: (() => void) | null = null
  let cancelCb: (() => void) | null = null
  const form: FakeForm = {
    element: {} as HTMLElement,
    disposed: false,
    apply: vi.fn(),
    onFieldChange(cb) {
      fieldCb = cb
      return () => (fieldCb = null)
    },
    onSubmit(cb) {
      submitCb = cb
      return () => (submitCb = null)
    },
    onCancel(cb) {
      cancelCb = cb
      return () => (cancelCb = null)
    },
    focusFirstField: vi.fn(),
    dispose: vi.fn(() => (form.disposed = true)),
    emitFieldChange(field, value) {
      fieldCb?.(field, value)
    },
    emitSubmit() {
      submitCb?.()
    },
    emitCancel() {
      cancelCb?.()
    }
  }
  return form
}

const createFakeGateway = () => ({
  listRepos: vi.fn<() => Promise<readonly RepoSummary[]>>(async () => [
    { id: 'repo-1', path: '/repo-1', displayName: 'Repo One', kind: 'git' }
  ]),
  createWorktree: vi.fn<(input: CreateWorktreeInput) => Promise<CreateWorktreeResult>>(
    async () => ({
      worktreeId: 'wt-1'
    })
  ),
  repoSetupCommand: vi.fn<(repo: string) => Promise<string | null>>(async () => null)
})

const setup = () => {
  const gateway = createFakeGateway()
  const menus: FakeMenu[] = []
  const forms: FakeForm[] = []
  const labelLayer = { add: vi.fn(), remove: vi.fn() }
  const hud = { appendChild: vi.fn() }
  const dispatch = vi.fn<(action: SpawnMenuAction) => void>()
  const refetch = vi.fn(async () => {})
  const deps: SpawnMenuControllerDeps = {
    gateway,
    createMenu: () => {
      const m = createFakeMenu()
      menus.push(m)
      return m
    },
    createForm: () => {
      const f = createFakeForm()
      forms.push(f)
      return f
    },
    labelLayer,
    hud,
    dispatch,
    nodeCenter: vi.fn(() => ({ x: 1, y: 2, z: 3 })),
    refetch,
    generateMutationId: () => 'fixed-mutation-id'
  }
  const controller = createSpawnMenuController(deps)
  return { controller, gateway, menus, forms, labelLayer, hud, dispatch, refetch, deps }
}

const radialSlice = (): SpawnMenuSlice => ({ view: 'radial', nodeId: 'a', repoSelector: null })

/** Graph whose only node `a` belongs to `repoId` — the anchor the radial/form is opened on. */
const graphWithAnchor = (repoId: string): WorktreeGraph => {
  const anchor: WorktreeNode = {
    id: 'a',
    repoId,
    branch: 'refs/heads/master',
    path: '/wt/a',
    status: 'in-progress',
    isMain: true,
    kind: 'root',
    parentId: null,
    childIds: [],
    activity: inertActivity()
  }
  return { ...emptyWorktreeGraph(), nodes: new Map([[anchor.id, anchor]]), rootIds: ['a'] }
}
const rootlessFormSlice = (): SpawnMenuSlice =>
  reduceSpawnMenu(emptySpawnMenuSlice(), { type: 'open-rootless' })

describe('createSpawnMenuController', () => {
  it('does nothing when the slice is closed', () => {
    const { controller, menus, forms } = setup()
    controller.sync(emptySpawnMenuSlice(), emptyWorktreeGraph())
    expect(menus).toHaveLength(0)
    expect(forms).toHaveLength(0)
  })

  it('mounts the radial menu into the label layer and applies the view model', () => {
    const { controller, menus, labelLayer } = setup()
    controller.sync(radialSlice(), emptyWorktreeGraph())
    expect(menus).toHaveLength(1)
    expect(labelLayer.add).toHaveBeenCalledWith(menus[0]!.object)
    expect(menus[0]!.applyCalls).toBe(1)
  })

  it('mounts the form into the hud and applies the view model', () => {
    const { controller, forms, hud } = setup()
    controller.sync(rootlessFormSlice(), emptyWorktreeGraph())
    expect(forms).toHaveLength(1)
    expect(hud.appendChild).toHaveBeenCalledWith(forms[0]!.element)
    expect(forms[0]!.apply).toHaveBeenCalled()
  })

  it('unmounts the radial menu when transitioning to the form', () => {
    const { controller, menus, forms, labelLayer } = setup()
    controller.sync(radialSlice(), emptyWorktreeGraph())
    const formSlice = reduceSpawnMenu(radialSlice(), { type: 'radial-select' })
    controller.sync(formSlice, emptyWorktreeGraph())
    expect(menus[0]!.disposed).toBe(true)
    expect(labelLayer.remove).toHaveBeenCalledWith(menus[0]!.object)
    expect(forms).toHaveLength(1)
  })

  it('unmounts everything when closing', () => {
    const { controller, forms } = setup()
    controller.sync(rootlessFormSlice(), emptyWorktreeGraph())
    controller.sync(emptySpawnMenuSlice(), emptyWorktreeGraph())
    expect(forms[0]!.disposed).toBe(true)
  })

  it('fetches repos exactly once on first open and resolves the repo selector', async () => {
    const { controller, gateway, dispatch } = setup()
    controller.sync(radialSlice(), emptyWorktreeGraph())
    await flush()
    expect(gateway.listRepos).toHaveBeenCalledOnce()
    expect(dispatch).toHaveBeenCalledWith({ type: 'set-repo-selector', repoSelector: 'id:repo-1' })

    // Real store flow: the dispatched set-repo-selector lands in the slice handed to the
    // next sync() — simulate that instead of an inert fake dispatch re-sending a blank slice.
    dispatch.mockClear()
    controller.sync({ ...radialSlice(), repoSelector: 'id:repo-1' }, emptyWorktreeGraph())
    await flush()
    expect(gateway.listRepos).toHaveBeenCalledOnce() // not refetched
  })

  it('probes the target repo setup once per open and re-applies the form with the no-setup hint', async () => {
    const { controller, gateway, forms } = setup()
    const slice: SpawnMenuSlice = { ...rootlessFormSlice(), repoSelector: 'id:repo-1' }
    controller.sync(slice, emptyWorktreeGraph())
    controller.sync(slice, emptyWorktreeGraph())
    await flush()
    expect(gateway.repoSetupCommand).toHaveBeenCalledOnce()
    expect(gateway.repoSetupCommand).toHaveBeenCalledWith('id:repo-1')
    expect(forms[0]!.apply).toHaveBeenLastCalledWith(
      expect.objectContaining({ setupHint: expect.stringContaining('sin setup') })
    )
  })

  it('shows no hint when the repo has a setup command', async () => {
    const { controller, gateway, forms } = setup()
    gateway.repoSetupCommand.mockResolvedValue('pnpm install')
    controller.sync({ ...rootlessFormSlice(), repoSelector: 'id:repo-1' }, emptyWorktreeGraph())
    await flush()
    expect(forms[0]!.apply).toHaveBeenLastCalledWith(expect.objectContaining({ setupHint: null }))
  })

  it('does not refetch once the slice already carries a resolved repoSelector', async () => {
    const { controller, gateway } = setup()
    controller.sync({ ...radialSlice(), repoSelector: 'id:repo-1' }, emptyWorktreeGraph())
    await flush()
    expect(gateway.listRepos).not.toHaveBeenCalled()
  })

  // Why: the child must land in the ANCHOR's repo. Resolving from the active repo spawned a
  // demo-repo-2 child into Cubito during live validation (spawn from `master` of another repo).
  it('resolves the repo selector from the anchor node repoId without listing repos', async () => {
    const { controller, gateway, dispatch } = setup()
    controller.sync(radialSlice(), graphWithAnchor('repo-anchor'))
    await flush()
    expect(gateway.listRepos).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith({
      type: 'set-repo-selector',
      repoSelector: 'id:repo-anchor'
    })
  })

  it('re-derives a cached selector that belongs to another repo than the anchor', async () => {
    const { controller, gateway, dispatch } = setup()
    controller.sync(
      { ...radialSlice(), repoSelector: 'id:repo-stale' },
      graphWithAnchor('repo-anchor')
    )
    await flush()
    expect(gateway.listRepos).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith({
      type: 'set-repo-selector',
      repoSelector: 'id:repo-anchor'
    })
  })

  it('prefers activeRepoId over the first listed repo when resolving the repo selector', async () => {
    const gateway = createFakeGateway()
    gateway.listRepos.mockResolvedValueOnce([
      { id: 'repo-1', path: '/repo-1', displayName: 'Repo One', kind: 'git' },
      { id: 'repo-2', path: '/repo-2', displayName: 'Repo Two', kind: 'git' }
    ])
    const dispatch = vi.fn<(action: SpawnMenuAction) => void>()
    const controller = createSpawnMenuController({
      gateway,
      createMenu: () => createFakeMenu(),
      createForm: () => createFakeForm(),
      labelLayer: { add: vi.fn(), remove: vi.fn() },
      hud: { appendChild: vi.fn() },
      dispatch,
      nodeCenter: vi.fn(),
      refetch: vi.fn(async () => {}),
      activeRepoId: () => 'repo-2'
    })
    controller.sync(radialSlice(), emptyWorktreeGraph())
    await flush()
    expect(dispatch).toHaveBeenCalledWith({ type: 'set-repo-selector', repoSelector: 'id:repo-2' })
  })

  it('falls back to the first listed repo when activeRepoId is null', async () => {
    const { controller, gateway, dispatch } = setup()
    controller.sync(radialSlice(), emptyWorktreeGraph())
    await flush()
    expect(gateway.listRepos).toHaveBeenCalledOnce()
    expect(dispatch).toHaveBeenCalledWith({ type: 'set-repo-selector', repoSelector: 'id:repo-1' })
  })

  it('wires field changes from the form to update-field dispatches', () => {
    const { controller, forms, dispatch } = setup()
    controller.sync(rootlessFormSlice(), emptyWorktreeGraph())
    forms[0]!.emitFieldChange('name', 'auth-retry-tests')
    expect(dispatch).toHaveBeenCalledWith({
      type: 'update-field',
      field: 'name',
      value: 'auth-retry-tests'
    })
  })

  it('wires cancel from the form to a cancel dispatch', () => {
    const { controller, forms, dispatch } = setup()
    controller.sync(rootlessFormSlice(), emptyWorktreeGraph())
    forms[0]!.emitCancel()
    expect(dispatch).toHaveBeenCalledWith({ type: 'cancel' })
  })

  it('submit success: builds the create input with the resolved repo + mutation id, dispatches submit/submit-ok, and refetches', async () => {
    const { controller, gateway, forms, dispatch, refetch } = setup()
    let slice: SpawnMenuSlice = { ...rootlessFormSlice(), repoSelector: 'id:repo-1' }
    slice = reduceSpawnMenu(slice, {
      type: 'update-field',
      field: 'name',
      value: 'auth-retry-tests'
    })
    controller.sync(slice, emptyWorktreeGraph())

    forms[0]!.emitSubmit()
    expect(dispatch).toHaveBeenCalledWith({ type: 'submit' })
    await flush()

    expect(gateway.createWorktree).toHaveBeenCalledWith({
      repo: 'id:repo-1',
      name: 'auth-retry-tests',
      clientMutationId: 'fixed-mutation-id'
    })
    expect(dispatch).toHaveBeenCalledWith({ type: 'submit-ok' })
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('selects the created worktree after the refetch, and not when the create fails', async () => {
    const order: string[] = []
    const select = vi.fn((id: string) => void order.push(`select:${id}`))
    const { controller, gateway, forms, deps } = setup()
    deps.refetch = vi.fn(async () => void order.push('refetch'))
    deps.selectCreated = select
    const withSelect = createSpawnMenuController(deps)
    const slice = reduceSpawnMenu(
      { ...rootlessFormSlice(), repoSelector: 'id:repo-1' },
      { type: 'update-field', field: 'name', value: 'x' }
    )
    withSelect.sync(slice, emptyWorktreeGraph())
    forms[forms.length - 1]!.emitSubmit()
    await flush()
    const created = await gateway.createWorktree.mock.results[0]!.value
    expect(order).toEqual(['refetch', `select:${created.worktreeId}`])

    gateway.createWorktree.mockRejectedValueOnce(new Error('boom'))
    forms[forms.length - 1]!.emitSubmit()
    await flush()
    expect(select).toHaveBeenCalledOnce()
    void controller
  })

  it('submit failure: dispatches submit-error with a readable message, no refetch', async () => {
    const { controller, gateway, forms, dispatch, refetch } = setup()
    gateway.createWorktree.mockRejectedValueOnce(new Error('conexión perdida'))
    let slice: SpawnMenuSlice = { ...rootlessFormSlice(), repoSelector: 'id:repo-1' }
    slice = reduceSpawnMenu(slice, { type: 'update-field', field: 'name', value: 'x' })
    controller.sync(slice, emptyWorktreeGraph())

    forms[0]!.emitSubmit()
    await flush()

    expect(dispatch).toHaveBeenCalledWith({
      type: 'submit-error',
      message: { lead: 'no se pudo crear el worktree', detail: 'conexión perdida' }
    })
    expect(refetch).not.toHaveBeenCalled()
  })

  it('an empty name submits with a generated language-neutral wt-<id prefix> name', async () => {
    const { controller, gateway, forms } = setup()
    const slice: SpawnMenuSlice = { ...rootlessFormSlice(), repoSelector: 'id:repo-1' }
    controller.sync(slice, emptyWorktreeGraph())

    forms[0]!.emitSubmit()
    await flush()

    expect(gateway.createWorktree).toHaveBeenCalledOnce()
    expect(gateway.createWorktree.mock.calls[0]![0].name).toBe('wt-fixedmutat')
  })

  it('submit is a no-op while the repo selector has not resolved yet', async () => {
    const { controller, gateway, forms, dispatch } = setup()
    let slice: SpawnMenuSlice = rootlessFormSlice() // repoSelector still null
    slice = reduceSpawnMenu(slice, { type: 'update-field', field: 'name', value: 'x' })
    controller.sync(slice, emptyWorktreeGraph())

    forms[0]!.emitSubmit()
    await flush()

    expect(gateway.createWorktree).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith({
      type: 'submit-error',
      message: { lead: expect.any(String), detail: null }
    })
  })

  it('positions the radial menu object from nodeCenter on tick()', () => {
    const { controller, menus, deps } = setup()
    controller.sync(radialSlice(), emptyWorktreeGraph())
    controller.tick()
    expect(deps.nodeCenter).toHaveBeenCalledWith('a')
    expect(menus[0]!.object.position.set).toHaveBeenCalled()
  })

  it('rebindGateway swaps the gateway used by a subsequent submit', async () => {
    const { controller, forms, dispatch } = setup()
    const newGateway = createFakeGateway()
    controller.rebindGateway(newGateway)

    let slice: SpawnMenuSlice = { ...rootlessFormSlice(), repoSelector: 'id:repo-1' }
    slice = reduceSpawnMenu(slice, { type: 'update-field', field: 'name', value: 'x' })
    controller.sync(slice, emptyWorktreeGraph())
    forms[0]!.emitSubmit()
    await flush()

    expect(newGateway.createWorktree).toHaveBeenCalledOnce()
    expect(dispatch).toHaveBeenCalledWith({ type: 'submit-ok' })
  })

  it('dispose unmounts and disposes whatever is currently mounted', () => {
    const { controller, forms } = setup()
    controller.sync(rootlessFormSlice(), emptyWorktreeGraph())
    controller.dispose()
    expect(forms[0]!.disposed).toBe(true)
  })
})
