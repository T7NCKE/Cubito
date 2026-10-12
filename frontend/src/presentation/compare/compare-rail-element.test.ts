import { describe, expect, it } from 'vitest'
import { createCompareRail } from './compare-rail-element'
import type { CompareRailRow } from './compare-rail-model'

type ClickHandler = (event: { stopPropagation(): void }) => void

type FakeElement = {
  tagName: string
  type: string
  readonly children: FakeElement[]
  className: string
  textContent: string
  title: string
  blurCount: number
  appendChild(child: FakeElement): FakeElement
  replaceChildren(): void
  remove(): void
  dispatchClick(): void
  addEventListener(type: string, handler: ClickHandler): void
  blur(): void
}

const createFakeElement = (tag: string): FakeElement => {
  let clickHandler: ClickHandler | null = null
  const el: FakeElement = {
    tagName: tag.toUpperCase(),
    type: '',
    children: [],
    className: '',
    textContent: '',
    title: '',
    blurCount: 0,
    appendChild(child) {
      el.children.push(child)
      return child
    },
    replaceChildren() {
      el.children.length = 0
    },
    remove() {},
    addEventListener(type, handler) {
      if (type === 'click') clickHandler = handler
    },
    dispatchClick() {
      clickHandler?.({ stopPropagation: () => {} })
    },
    blur() {
      el.blurCount++
    }
  }
  return el
}

const createFakeDocument = (): Document =>
  ({ createElement: (tag: string) => createFakeElement(tag) }) as unknown as Document

const rootOf = (handle: ReturnType<typeof createCompareRail>) =>
  handle.root as unknown as FakeElement

const row = (
  overrides: Partial<CompareRailRow> & Pick<CompareRailRow, 'childId'>
): CompareRailRow => ({
  label: `cubito-${overrides.childId}`,
  title: `refs/heads/cubito-${overrides.childId}`,
  statText: '0 archivos · +0 −0',
  status: 'ready',
  focused: false,
  isWinner: false,
  cssClass: 'compare-rail__row compare-rail__row--ready',
  winnerToggleLabel: 'elegir ganador',
  failure: null,
  ...overrides
})

describe('createCompareRail', () => {
  it('renders one row per member', () => {
    const rail = createCompareRail(createFakeDocument())
    rail.apply([row({ childId: 'a' }), row({ childId: 'b' })])
    expect(rootOf(rail).children).toHaveLength(2)
  })

  it('applies each row cssClass verbatim', () => {
    const rail = createCompareRail(createFakeDocument())
    rail.apply([
      row({ childId: 'a', cssClass: 'compare-rail__row compare-rail__row--focused' }),
      row({ childId: 'b', cssClass: 'compare-rail__row compare-rail__row--winner' })
    ])
    const [rowA, rowB] = rootOf(rail).children
    expect(rowA!.className).toBe('compare-rail__row compare-rail__row--focused')
    expect(rowB!.className).toBe('compare-rail__row compare-rail__row--winner')
  })

  it('renders the label, stat text and winner-toggle label', () => {
    const rail = createCompareRail(createFakeDocument())
    rail.apply([
      row({
        childId: 'a',
        label: 'cubito-alpha',
        statText: '3 archivos · +10 −2',
        winnerToggleLabel: 'ganador'
      })
    ])
    const rowEl = rootOf(rail).children[0]!
    expect(rowEl.children[0]!.textContent).toBe('cubito-alpha')
    expect(rowEl.children[1]!.textContent).toBe('3 archivos · +10 −2')
    expect(rowEl.children[2]!.textContent).toBe('ganador')
  })

  it("sets the label span's title to row.title (full ref tooltip)", () => {
    const rail = createCompareRail(createFakeDocument())
    rail.apply([row({ childId: 'a', label: 'camada-x-1', title: 'refs/heads/camada-x-1' })])
    const rowEl = rootOf(rail).children[0]!
    expect(rowEl.children[0]!.title).toBe('refs/heads/camada-x-1')
  })

  it('renders a failed child as a failure line after the toggle, in place of nothing', () => {
    const rail = createCompareRail(createFakeDocument())
    rail.apply([
      row({ childId: 'a', failure: { lead: 'no se pudo leer los cambios', detail: 'boom' } }),
      row({ childId: 'b' })
    ])
    const [failed, ok] = rootOf(rail).children
    expect(failed!.children).toHaveLength(4)
    const line = failed!.children[3]!
    expect(line.className).toBe('compare-rail__error')
    expect(line.textContent).toBe('no se pudo leer los cambios')
    expect(line.children[0]!.textContent).toBe('boom')
    expect(ok!.children).toHaveLength(3)
  })

  it('calls onFocusChild with the clicked row childId', () => {
    const rail = createCompareRail(createFakeDocument())
    rail.apply([row({ childId: 'a' }), row({ childId: 'b' })])
    const focused: string[] = []
    rail.onFocusChild((childId) => focused.push(childId))
    rootOf(rail).children[1]!.dispatchClick()
    expect(focused).toEqual(['b'])
  })

  it('calls onSetWinner with the childId when not currently the winner', () => {
    const rail = createCompareRail(createFakeDocument())
    rail.apply([row({ childId: 'a', isWinner: false })])
    const winners: (string | null)[] = []
    rail.onSetWinner((childId) => winners.push(childId))
    rootOf(rail).children[0]!.children[2]!.dispatchClick() // the winner-toggle button
    expect(winners).toEqual(['a'])
  })

  it('blurs the winner toggle after a click (risk 3: a focused button re-fires on Enter, which descend-island would otherwise leave un-prevented)', () => {
    const rail = createCompareRail(createFakeDocument())
    rail.apply([row({ childId: 'a' })])
    const winnerToggle = rootOf(rail).children[0]!.children[2]!
    winnerToggle.dispatchClick()
    expect(winnerToggle.blurCount).toBe(1)
  })

  it('calls onSetWinner with null to clear when the row is already the winner', () => {
    const rail = createCompareRail(createFakeDocument())
    rail.apply([row({ childId: 'a', isWinner: true })])
    const winners: (string | null)[] = []
    rail.onSetWinner((childId) => winners.push(childId))
    rootOf(rail).children[0]!.children[2]!.dispatchClick()
    expect(winners).toEqual([null])
  })

  it('renders an empty-state element for an empty rows list', () => {
    const rail = createCompareRail(createFakeDocument())
    rail.apply([])
    const root = rootOf(rail)
    expect(root.children).toHaveLength(1)
    expect(root.children[0]!.textContent).toBe('sin hijos')
  })

  it('re-applying replaces previous rows rather than accumulating them', () => {
    const rail = createCompareRail(createFakeDocument())
    rail.apply([row({ childId: 'a' })])
    rail.apply([row({ childId: 'b' }), row({ childId: 'c' })])
    expect(rootOf(rail).children).toHaveLength(2)
  })

  it('dispose removes the root element', () => {
    const rail = createCompareRail(createFakeDocument())
    const root = rootOf(rail)
    let removed = false
    root.remove = () => (removed = true)
    rail.dispose()
    expect(removed).toBe(true)
  })
})
