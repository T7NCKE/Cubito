import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setActiveLanguage } from '../../application/i18n/translate'
import { createCompareHud } from './compare-hud-element'
import { createCompareMergeAction } from './compare-merge-action-element'
import { compareRailViewModel } from './compare-rail-model'

type FakeElement = {
  children: FakeElement[]
  textContent: string
  hidden: boolean
  disabled: boolean
  checked: boolean
  type: string
  className: string
  style: Record<string, string>
  appendChild(child: FakeElement): FakeElement
  replaceChildren(): void
  addEventListener(): void
  remove(): void
  blur(): void
}

const fakeElement = (): FakeElement => {
  const el: FakeElement = {
    children: [],
    textContent: '',
    hidden: false,
    disabled: false,
    checked: false,
    type: '',
    className: '',
    style: {},
    appendChild(child) {
      el.children.push(child)
      return child
    },
    replaceChildren() {
      el.children.length = 0
    },
    addEventListener() {},
    remove() {},
    blur() {}
  }
  return el
}
const fakeDocument = (): Document => ({ createElement: () => fakeElement() }) as unknown as Document
const flatten = (el: FakeElement): FakeElement[] => [el, ...el.children.flatMap(flatten)]

beforeEach(() => setActiveLanguage('en'))
afterEach(() => setActiveLanguage('es'))

describe('compare surfaces in English', () => {
  it('HUD shows the mode and the winner line', () => {
    const hud = createCompareHud(fakeDocument())
    hud.apply({
      connection: { state: 'connected', runtimeId: 'r1' },
      membersCount: 3,
      winnerLabel: null
    })
    const texts = flatten(hud.root as unknown as FakeElement).map((e) => e.textContent)
    expect(texts).toContain('compare the litter')
    expect(texts).toContain('3 children · winner: none picked')
  })

  it('rail rows localize stats and winner toggle', () => {
    const [row] = compareRailViewModel({
      members: ['c1'],
      childLoads: {},
      focusedChildId: null,
      winnerId: null,
      branchLabelFor: () => 'refs/heads/alpha'
    })
    expect(row!.statText).toBe('0 files · +0 −0')
    expect(row!.winnerToggleLabel).toBe('pick winner')
  })

  it('merge action copy is English for the clean result', () => {
    const action = createCompareMergeAction(fakeDocument())
    action.apply({
      visible: true,
      capable: true,
      syncCapable: true,
      merge: { phase: 'clean', commitOid: 'abcdef1234' }
    })
    const texts = flatten(action.root as unknown as FakeElement).map((e) => e.textContent)
    expect(texts).toContain('merge winner')
    expect(texts).toContain('sync the parent')
    expect(texts).toContain(
      'Merged into the parent (abcdef1), but its files were not synced. In the parent worktree run `git read-tree -u -m abcdef1^1 HEAD` (keeps your local edits) or `git reset --hard` (discards them).'
    )
  })
})
