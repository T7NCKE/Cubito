import { plainFailure } from '../../application/i18n/user-facing-error'
import { describe, expect, it, vi } from 'vitest'
import { createProjectSelector, resolveProjectSelectorKey } from './project-selector-element'
import type { ProjectSelectorPanelModel } from './project-selector-element'

describe('resolveProjectSelectorKey', () => {
  it('list view: ArrowDown and Tab both cycle forward, ArrowUp cycles back', () => {
    expect(resolveProjectSelectorKey('list', 'ArrowDown')).toEqual({ type: 'highlight', delta: 1 })
    expect(resolveProjectSelectorKey('list', 'Tab')).toEqual({ type: 'highlight', delta: 1 })
    expect(resolveProjectSelectorKey('list', 'ArrowUp')).toEqual({ type: 'highlight', delta: -1 })
  })

  it('list view: Enter activates, Escape closes', () => {
    expect(resolveProjectSelectorKey('list', 'Enter')).toEqual({ type: 'activate' })
    expect(resolveProjectSelectorKey('list', 'Escape')).toEqual({ type: 'close' })
  })

  it('list view: an ordinary keystroke resolves to nothing', () => {
    expect(resolveProjectSelectorKey('list', 'a')).toBeNull()
  })

  it('add-form view: Escape cancels back to the list, Enter submits', () => {
    expect(resolveProjectSelectorKey('add-form', 'Escape')).toEqual({ type: 'cancel' })
    expect(resolveProjectSelectorKey('add-form', 'Enter')).toEqual({ type: 'submit' })
  })

  it('add-form view: an ordinary keystroke resolves to nothing', () => {
    expect(resolveProjectSelectorKey('add-form', 'a')).toBeNull()
  })
})

type FakeElement = {
  tagName: string
  readonly style: Record<string, string>
  readonly children: FakeElement[]
  className: string
  textContent: string
  value: string
  placeholder: string
  disabled: boolean
  readonly listeners: Record<string, ((event: unknown) => void)[]>
  addEventListener(type: string, cb: (event: unknown) => void): void
  removeEventListener(type: string, cb: (event: unknown) => void): void
  appendChild(child: FakeElement): FakeElement
  replaceChildren(): void
  setAttribute(): void
  remove(): void
  focus(): void
  fire(type: string, event?: Record<string, unknown>): void
}

const createFakeElement = (tag: string): FakeElement => {
  const listeners: Record<string, ((event: unknown) => void)[]> = {}
  const el: FakeElement = {
    tagName: tag.toUpperCase(),
    style: {},
    children: [],
    className: '',
    textContent: '',
    value: '',
    placeholder: '',
    disabled: false,
    listeners,
    addEventListener(type, cb) {
      ;(listeners[type] ??= []).push(cb)
    },
    removeEventListener(type, cb) {
      listeners[type] = (listeners[type] ?? []).filter((l) => l !== cb)
    },
    appendChild(child) {
      el.children.push(child)
      return child
    },
    replaceChildren() {
      el.children.length = 0
    },
    setAttribute() {},
    remove() {},
    focus() {},
    fire(type, event = {}) {
      for (const cb of [...(listeners[type] ?? [])])
        cb({ target: el, preventDefault: () => {}, ...event })
    }
  }
  return el
}

const createFakeDocument = (): Document =>
  ({ createElement: (tag: string) => createFakeElement(tag) }) as unknown as Document

const listModel = (
  overrides: Partial<Extract<ProjectSelectorPanelModel, { view: 'list' }>> = {}
) => ({
  view: 'list' as const,
  query: '',
  rows: [],
  addRowHighlighted: true,
  ...overrides
})

const formModel = (
  overrides: Partial<Extract<ProjectSelectorPanelModel, { view: 'add-form' }>> = {}
) => ({
  view: 'add-form' as const,
  path: '',
  kind: 'git' as const,
  setup: '',
  submitLabel: 'agregar repo',
  submitEnabled: false,
  errorMessage: null,
  ...overrides
})

const rootOf = (handle: ReturnType<typeof createProjectSelector>) =>
  handle.element as unknown as FakeElement

const queryInputOf = (root: FakeElement) => root.children[0]!.children[0]!
const rowsOf = (root: FakeElement) => root.children[0]!.children[1]!
const addRowOf = (root: FakeElement) => root.children[0]!.children[2]!
const pathInputOf = (root: FakeElement) => root.children[1]!.children[0]!
const pathHelpOf = (root: FakeElement) => root.children[1]!.children[1]!
const kindSelectOf = (root: FakeElement) => root.children[1]!.children[2]!
const setupInputOf = (root: FakeElement) => root.children[1]!.children[3]!
const errorLineOf = (root: FakeElement) => root.children[1]!.children[4]!
const submitButtonOf = (root: FakeElement) => root.children[1]!.children[5]!
const cancelButtonOf = (root: FakeElement) => root.children[1]!.children[6]!
const setupSectionOf = (root: FakeElement) => root.children[0]!.children[3]!

describe('createProjectSelector — add-repo path guidance', () => {
  it('the path field carries a placeholder that says which machine the path lives on', () => {
    const selector = createProjectSelector(createFakeDocument())
    expect(pathInputOf(rootOf(selector)).placeholder).toContain('/repos/')
  })

  it('a short help line covers both native and Docker orcad', () => {
    const selector = createProjectSelector(createFakeDocument())
    const help = pathHelpOf(rootOf(selector)).textContent
    expect(help).toContain('orcad')
    expect(help).toContain('Docker')
    expect(help).toContain('/repos/')
  })
})

describe('createProjectSelector — setup', () => {
  it('add-form setup input writes the model value and emits a setup field change', () => {
    const selector = createProjectSelector(createFakeDocument())
    const changes: [string, string][] = []
    selector.onAddFieldChange((field, value) => changes.push([field, value]))
    selector.apply(formModel({ setup: 'pnpm install' }))
    const input = setupInputOf(rootOf(selector))
    expect(input.value).toBe('pnpm install')
    input.value = 'yarn'
    input.fire('input')
    expect(changes).toEqual([['setup', 'yarn']])
  })

  it('applySetup(null) hides the list setup section; a model shows it with the current command', () => {
    const selector = createProjectSelector(createFakeDocument())
    selector.apply(listModel())
    const section = setupSectionOf(rootOf(selector))
    selector.applySetup(null)
    expect(section.style.display).toBe('none')
    selector.applySetup({ repoName: 'Cubito', command: 'pnpm install', message: plainFailure('') })
    expect(section.style.display).toBe('')
    expect(section.children[0]!.textContent).toContain('Cubito')
    expect(section.children[1]!.value).toBe('pnpm install')
    selector.applySetup({ repoName: 'Cubito', command: null, message: plainFailure('') })
    expect(section.children[1]!.value).toBe('')
    expect(section.children[1]!.placeholder).toContain('sin setup')
    selector.applySetup({
      repoName: 'Cubito',
      command: null,
      sharedCommand: 'pnpm i',
      message: plainFailure('')
    })
    expect(section.children[0]!.textContent).toContain('orca.yaml')
    expect(section.children[0]!.textContent).toContain('pnpm i')
    expect(section.children[1]!.placeholder).not.toContain('sin setup')
  })

  it('saves the typed command on Enter or the save button without triggering list activation', () => {
    const selector = createProjectSelector(createFakeDocument())
    const saved: string[] = []
    const activated: string[] = []
    const closed = vi.fn()
    selector.onSetupSave((command) => saved.push(command))
    selector.onActivate((id) => activated.push(id))
    selector.onClose(closed)
    selector.apply(
      listModel({
        rows: [{ repoId: 'r1', displayName: 'A', path: '/a', active: true, highlighted: true }]
      })
    )
    selector.applySetup({ repoName: 'A', command: null, message: plainFailure('') })
    const section = setupSectionOf(rootOf(selector))
    const input = section.children[1]!
    input.value = 'pnpm install'
    input.fire('keydown', { key: 'Enter', stopPropagation: () => {} })
    section.children[2]!.fire('click')
    input.fire('keydown', { key: 'Escape', stopPropagation: () => {} })
    expect(saved).toEqual(['pnpm install', 'pnpm install'])
    expect(activated).toEqual([])
    expect(closed).toHaveBeenCalledOnce()
  })
})

describe('createProjectSelector', () => {
  it('apply() in list view shows the list section, hides the form, and writes the query', () => {
    const selector = createProjectSelector(createFakeDocument())
    selector.apply(listModel({ query: 'cubi' }))
    const root = rootOf(selector)
    expect(root.children[0]!.style.display).toBe('')
    expect(root.children[1]!.style.display).toBe('none')
    expect(queryInputOf(root).value).toBe('cubi')
  })

  it('apply() renders one row per repo, marking active and highlighted rows', () => {
    const selector = createProjectSelector(createFakeDocument())
    selector.apply(
      listModel({
        rows: [
          { repoId: 'a', displayName: 'Repo A', path: '/a', active: false, highlighted: true },
          { repoId: 'b', displayName: 'Repo B', path: '/b', active: true, highlighted: false }
        ],
        addRowHighlighted: false
      })
    )
    const root = rootOf(selector)
    const rows = rowsOf(root)
    expect(rows.children).toHaveLength(2)
    expect(rows.children[0]!.className).toContain('highlighted')
    expect(rows.children[0]!.className).not.toContain('active')
    expect(rows.children[1]!.className).toContain('active')
    expect(rows.children[1]!.className).not.toContain('highlighted')
    expect(addRowOf(root).className).not.toContain('highlighted')
  })

  it('apply() re-renders rows from scratch each call (no stale rows)', () => {
    const selector = createProjectSelector(createFakeDocument())
    selector.apply(
      listModel({
        rows: [{ repoId: 'a', displayName: 'A', path: '/a', active: false, highlighted: true }]
      })
    )
    selector.apply(listModel({ rows: [] }))
    expect(rowsOf(rootOf(selector)).children).toHaveLength(0)
  })

  it('apply() in add-form view shows the form section, hides the list, and writes fields', () => {
    const selector = createProjectSelector(createFakeDocument())
    selector.apply(formModel({ path: '/abs/path', kind: 'folder', submitEnabled: true }))
    const root = rootOf(selector)
    expect(root.children[0]!.style.display).toBe('none')
    expect(root.children[1]!.style.display).toBe('')
    expect(pathInputOf(root).value).toBe('/abs/path')
    expect(kindSelectOf(root).value).toBe('folder')
    expect(submitButtonOf(root).disabled).toBe(false)
  })

  it('shows the add-form error message when present, hides it when absent', () => {
    const selector = createProjectSelector(createFakeDocument())
    selector.apply(formModel({ errorMessage: plainFailure('no es un repo git') }))
    const root = rootOf(selector)
    expect(errorLineOf(root).textContent).toBe('no es un repo git')
    expect(errorLineOf(root).style.display).toBe('')
    selector.apply(formModel())
    expect(errorLineOf(root).style.display).toBe('none')
  })

  it('typing in the query input fires onQueryChange', () => {
    const selector = createProjectSelector(createFakeDocument())
    selector.apply(listModel())
    const onQueryChange = vi.fn()
    selector.onQueryChange(onQueryChange)
    const root = rootOf(selector)
    const input = queryInputOf(root)
    input.value = 'foo'
    input.fire('input')
    expect(onQueryChange).toHaveBeenCalledWith('foo')
  })

  it('ArrowDown/ArrowUp/Tab in the list fire onHighlight with the right delta, Tab prevents default', () => {
    const selector = createProjectSelector(createFakeDocument())
    selector.apply(listModel())
    const onHighlight = vi.fn()
    selector.onHighlight(onHighlight)
    const root = rootOf(selector)
    root.fire('keydown', { key: 'ArrowDown' })
    expect(onHighlight).toHaveBeenCalledWith(1)
    root.fire('keydown', { key: 'ArrowUp' })
    expect(onHighlight).toHaveBeenCalledWith(-1)
    const preventDefault = vi.fn()
    root.fire('keydown', { key: 'Tab', preventDefault })
    expect(onHighlight).toHaveBeenCalledWith(1)
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('Enter on a highlighted repo row fires onActivate with its repoId', () => {
    const selector = createProjectSelector(createFakeDocument())
    selector.apply(
      listModel({
        rows: [{ repoId: 'a', displayName: 'A', path: '/a', active: false, highlighted: true }],
        addRowHighlighted: false
      })
    )
    const onActivate = vi.fn()
    selector.onActivate(onActivate)
    rootOf(selector).fire('keydown', { key: 'Enter' })
    expect(onActivate).toHaveBeenCalledWith('a')
  })

  it('Enter on the highlighted add-row fires onOpenAddForm instead of onActivate', () => {
    const selector = createProjectSelector(createFakeDocument())
    selector.apply(listModel({ rows: [], addRowHighlighted: true }))
    const onActivate = vi.fn()
    const onOpenAddForm = vi.fn()
    selector.onActivate(onActivate)
    selector.onOpenAddForm(onOpenAddForm)
    rootOf(selector).fire('keydown', { key: 'Enter' })
    expect(onOpenAddForm).toHaveBeenCalledOnce()
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('clicking a row fires onActivate with its repoId', () => {
    const selector = createProjectSelector(createFakeDocument())
    selector.apply(
      listModel({
        rows: [{ repoId: 'z', displayName: 'Z', path: '/z', active: false, highlighted: false }]
      })
    )
    const onActivate = vi.fn()
    selector.onActivate(onActivate)
    rowsOf(rootOf(selector)).children[0]!.fire('click')
    expect(onActivate).toHaveBeenCalledWith('z')
  })

  it('Escape in the list fires onClose', () => {
    const selector = createProjectSelector(createFakeDocument())
    selector.apply(listModel())
    const onClose = vi.fn()
    selector.onClose(onClose)
    rootOf(selector).fire('keydown', { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape in the add-form fires onAddCancel, not onClose', () => {
    const selector = createProjectSelector(createFakeDocument())
    selector.apply(formModel())
    const onClose = vi.fn()
    const onAddCancel = vi.fn()
    selector.onClose(onClose)
    selector.onAddCancel(onAddCancel)
    rootOf(selector).fire('keydown', { key: 'Escape' })
    expect(onAddCancel).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Enter in the add-form fires onAddSubmit', () => {
    const selector = createProjectSelector(createFakeDocument())
    selector.apply(formModel())
    const onAddSubmit = vi.fn()
    selector.onAddSubmit(onAddSubmit)
    rootOf(selector).fire('keydown', { key: 'Enter' })
    expect(onAddSubmit).toHaveBeenCalledOnce()
  })

  it('typing the path field fires onAddFieldChange("path", value)', () => {
    const selector = createProjectSelector(createFakeDocument())
    selector.apply(formModel())
    const onAddFieldChange = vi.fn()
    selector.onAddFieldChange(onAddFieldChange)
    const root = rootOf(selector)
    const input = pathInputOf(root)
    input.value = '/abs/x'
    input.fire('input')
    expect(onAddFieldChange).toHaveBeenCalledWith('path', '/abs/x')
  })

  it('choosing a kind fires onAddFieldChange("kind", value)', () => {
    const selector = createProjectSelector(createFakeDocument())
    selector.apply(formModel())
    const onAddFieldChange = vi.fn()
    selector.onAddFieldChange(onAddFieldChange)
    const root = rootOf(selector)
    const select = kindSelectOf(root)
    select.value = 'folder'
    select.fire('change')
    expect(onAddFieldChange).toHaveBeenCalledWith('kind', 'folder')
  })

  it('clicking the add-repo row opens the add form', () => {
    const selector = createProjectSelector(createFakeDocument())
    const onOpenAddForm = vi.fn()
    selector.onOpenAddForm(onOpenAddForm)
    selector.apply(listModel())
    addRowOf(rootOf(selector)).fire('click')
    expect(onOpenAddForm).toHaveBeenCalledOnce()
  })

  it('clicking agregar repo fires onAddSubmit, clicking cancelar fires onAddCancel', () => {
    const selector = createProjectSelector(createFakeDocument())
    selector.apply(formModel())
    const onAddSubmit = vi.fn()
    const onAddCancel = vi.fn()
    selector.onAddSubmit(onAddSubmit)
    selector.onAddCancel(onAddCancel)
    const root = rootOf(selector)
    submitButtonOf(root).fire('click')
    cancelButtonOf(root).fire('click')
    expect(onAddSubmit).toHaveBeenCalledOnce()
    expect(onAddCancel).toHaveBeenCalledOnce()
  })

  it('focusQuery focuses the query input', () => {
    const selector = createProjectSelector(createFakeDocument())
    const root = rootOf(selector)
    const input = queryInputOf(root)
    let focused = false
    input.focus = () => (focused = true)
    selector.focusQuery()
    expect(focused).toBe(true)
  })

  it('focusPath focuses the add-form path input', () => {
    const selector = createProjectSelector(createFakeDocument())
    const root = rootOf(selector)
    const input = pathInputOf(root)
    let focused = false
    input.focus = () => (focused = true)
    selector.focusPath()
    expect(focused).toBe(true)
  })

  it('dispose removes the root element', () => {
    const selector = createProjectSelector(createFakeDocument())
    const root = rootOf(selector)
    let removed = false
    root.remove = () => (removed = true)
    selector.dispose()
    expect(removed).toBe(true)
  })
})
