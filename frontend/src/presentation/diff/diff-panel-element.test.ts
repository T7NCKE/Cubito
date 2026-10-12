import { plainFailure } from '../../application/i18n/user-facing-error'
import { describe, expect, it } from 'vitest'
import { createDiffPanel } from './diff-panel-element'
import type { DiffPanelView } from './diff-panel-model'

type FakeElement = {
  tagName: string
  readonly style: Record<string, string>
  readonly children: FakeElement[]
  className: string
  textContent: string
  appendChild(child: FakeElement): FakeElement
  replaceChildren(): void
  remove(): void
}

const createFakeElement = (tag: string): FakeElement => {
  const el: FakeElement = {
    tagName: tag.toUpperCase(),
    style: {},
    children: [],
    className: '',
    textContent: '',
    appendChild(child) {
      el.children.push(child)
      return child
    },
    replaceChildren() {
      el.children.length = 0
    },
    remove() {}
  }
  return el
}

const createFakeDocument = (): Document =>
  ({ createElement: (tag: string) => createFakeElement(tag) }) as unknown as Document

const elementOf = (handle: ReturnType<typeof createDiffPanel>) =>
  handle.element as unknown as FakeElement

describe('createDiffPanel', () => {
  it('renders one row per line with its cssClass and gutters', () => {
    const panel = createDiffPanel(createFakeDocument())
    const vm: DiffPanelView = {
      kind: 'lines',
      truncated: false,
      lines: [
        { cssClass: 'diff-line--ctx', oldNo: 1, newNo: 1, text: 'a' },
        { cssClass: 'diff-line--del', oldNo: 2, newNo: null, text: 'b' },
        { cssClass: 'diff-line--add', oldNo: null, newNo: 2, text: 'c' }
      ]
    }
    panel.apply(vm)
    const linesContainer = elementOf(panel).children[0]!
    expect(linesContainer.children).toHaveLength(3)
    const [ctx, del, add] = linesContainer.children
    expect(ctx!.className).toBe('diff-line--ctx')
    expect(ctx!.children[0]!.textContent).toBe('1')
    expect(ctx!.children[1]!.textContent).toBe('1')
    expect(ctx!.children[2]!.textContent).toBe('a')
    expect(del!.className).toBe('diff-line--del')
    expect(del!.children[0]!.textContent).toBe('2')
    expect(del!.children[1]!.textContent).toBe('')
    expect(add!.className).toBe('diff-line--add')
    expect(add!.children[0]!.textContent).toBe('')
    expect(add!.children[1]!.textContent).toBe('2')
  })

  it('renders a truncated footer only when truncated is true', () => {
    const panel = createDiffPanel(createFakeDocument())
    panel.apply({ kind: 'lines', truncated: true, lines: [] })
    expect(elementOf(panel).children).toHaveLength(2)
    expect(elementOf(panel).children[1]!.textContent).toBe('diff recortado (límite de contenido)')

    panel.apply({ kind: 'lines', truncated: false, lines: [] })
    expect(elementOf(panel).children).toHaveLength(1)
  })

  it('renders a binary message, with a deleted marker when deleted', () => {
    const panel = createDiffPanel(createFakeDocument())
    panel.apply({ kind: 'binary', deleted: false })
    expect(elementOf(panel).children[0]!.textContent).toBe('archivo binario · sin vista de diff')

    panel.apply({ kind: 'binary', deleted: true })
    expect(elementOf(panel).children[0]!.textContent).toContain('archivo binario')
    expect(elementOf(panel).children[0]!.textContent).toContain('eliminado')
  })

  it('renders a loading hint', () => {
    const panel = createDiffPanel(createFakeDocument())
    panel.apply({ kind: 'loading' })
    expect(elementOf(panel).children[0]!.textContent).toBe('cargando…')
  })

  it('renders an idle hint', () => {
    const panel = createDiffPanel(createFakeDocument())
    panel.apply({ kind: 'idle' })
    expect(elementOf(panel).children[0]!.textContent).toBe('elegí un archivo')
  })

  it('renders the error message when present', () => {
    const panel = createDiffPanel(createFakeDocument())
    panel.apply({ kind: 'error', message: plainFailure('boom') })
    expect(elementOf(panel).children[0]!.textContent).toBe('boom')
  })

  it('renders a fallback message when error has no message', () => {
    const panel = createDiffPanel(createFakeDocument())
    panel.apply({ kind: 'error' })
    expect(elementOf(panel).children[0]!.textContent.length).toBeGreaterThan(0)
  })

  it('re-applying replaces the previous content rather than accumulating it', () => {
    const panel = createDiffPanel(createFakeDocument())
    panel.apply({ kind: 'idle' })
    panel.apply({ kind: 'loading' })
    expect(elementOf(panel).children).toHaveLength(1)
    expect(elementOf(panel).children[0]!.textContent).toBe('cargando…')
  })

  it('dispose removes the element', () => {
    const panel = createDiffPanel(createFakeDocument())
    const element = elementOf(panel)
    let removed = false
    element.remove = () => (removed = true)
    panel.dispose()
    expect(removed).toBe(true)
  })

  it('keeps the scroll position across a lines-to-lines refresh but not across a file switch', () => {
    const panel = createDiffPanel(createFakeDocument())
    const element = elementOf(panel) as FakeElement & { scrollTop: number; scrollLeft: number }
    element.scrollTop = 0
    element.scrollLeft = 0
    const rebuild = element.replaceChildren.bind(element)
    // Real browsers reset the scroll offset once the content is emptied.
    element.replaceChildren = () => {
      rebuild()
      element.scrollTop = 0
      element.scrollLeft = 0
    }
    const lines: DiffPanelView = { kind: 'lines', truncated: false, lines: [] }
    panel.apply(lines)
    element.scrollTop = 240
    element.scrollLeft = 12

    panel.apply(lines)
    expect([element.scrollTop, element.scrollLeft]).toEqual([240, 12])

    panel.apply({ kind: 'loading' })
    panel.apply(lines)
    expect(element.scrollTop).toBe(0)
  })
})
