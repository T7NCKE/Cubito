import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setActiveLanguage } from '../../application/i18n/translate'
import { createDiffHud } from './diff-hud-element'
import { createDiffPanel } from './diff-panel-element'
import { createSourceControlComposer } from './source-control-composer-element'
import { diffRailFailure, diffRailViewModel } from './diff-rail-model'
import { sourceControlModel } from './source-control-view-model'
import type { SourceControlView } from '../../application/source-control-flow'
import { railErrorMessageFor } from '../../application/diff-live-loader'
import {
  blockedReasonText,
  reviewPrimaryAction
} from '../../application/hosted-review-presentation'

type FakeElement = Record<string, unknown> & {
  children: FakeElement[]
  textContent: string
  placeholder: string
}

const fakeElement = (): FakeElement => {
  const el = {
    children: [] as FakeElement[],
    textContent: '',
    placeholder: '',
    style: {},
    classList: { toggle() {} },
    appendChild(child: FakeElement) {
      el.children.push(child)
      return child
    },
    replaceChildren() {
      el.children.length = 0
    },
    addEventListener() {},
    remove() {}
  }
  return el as unknown as FakeElement
}

const fakeDocument = (): Document => ({ createElement: () => fakeElement() }) as unknown as Document

const flatten = (el: FakeElement): FakeElement[] => [el, ...el.children.flatMap(flatten)]

beforeEach(() => setActiveLanguage('en'))
afterEach(() => setActiveLanguage('es'))

describe('diff surfaces in English', () => {
  it('diff panel renders idle, loading, binary and truncated copy', () => {
    const panel = createDiffPanel(fakeDocument())
    const el = panel.element as unknown as FakeElement
    panel.apply({ kind: 'idle' })
    expect(el.children[0]!.textContent).toBe('pick a file')
    panel.apply({ kind: 'loading' })
    expect(el.children[0]!.textContent).toBe('loading…')
    panel.apply({ kind: 'binary', deleted: true })
    expect(el.children[0]!.textContent).toBe('binary file · no diff view · deleted')
    panel.apply({ kind: 'lines', truncated: true, lines: [] })
    expect(el.children[1]!.textContent).toBe('diff truncated (content limit)')
  })

  it('diff HUD shows the file totals against base', () => {
    const hud = createDiffHud(fakeDocument())
    hud.apply({
      connection: { state: 'connected', runtimeId: 'r1' },
      branch: 'feat',
      counts: { files: 2, added: 5, removed: 1 }
    })
    const texts = flatten(hud.root as unknown as FakeElement).map((e) => e.textContent)
    expect(texts).toContain('feat · diff')
    expect(texts).toContain('2 files · +5 −1 vs base')
  })

  it('rail rows localize origin and stage labels', () => {
    const [row] = diffRailViewModel(
      [{ path: 'a.ts', status: 'untracked', added: 1, removed: 0, origin: 'working' }],
      null,
      new Map([['a.ts', 'unstaged' as const]])
    )
    expect(row!.originText).toBe('new file')
    expect(row!.stage?.label).toBe('stage')
  })

  it('rail error reasons are English', () => {
    expect(railErrorMessageFor('no-merge-base')).toBe('no common ancestor with the base')
  })

  it('rail failure fallback is English', () => {
    expect(diffRailFailure('error', undefined)).toEqual({
      lead: 'something went wrong',
      detail: null
    })
  })

  it('composer placeholders and draft toggle are English', () => {
    const composer = createSourceControlComposer(fakeDocument())
    const all = flatten(composer.root as unknown as FakeElement)
    expect(all.map((e) => e.placeholder)).toEqual(
      expect.arrayContaining(['commit message', 'title', 'description'])
    )
    expect(all.map((e) => e.textContent)).toEqual(expect.arrayContaining(['draft', 'open']))
  })

  it('source-control model labels, status line and review actions are English', () => {
    const view = {
      phase: 'ready',
      nodeId: 'n',
      stagedCount: 2,
      hasUpstream: false,
      ahead: 0,
      behind: 0,
      message: '',
      busy: null,
      notice: null,
      canCommit: false,
      canPush: true,
      stageStates: new Map(),
      review: { phase: 'unavailable' }
    } as unknown as SourceControlView
    const model = sourceControlModel(view)
    expect(model.statusLine).toBe('2 staged · no upstream')
    expect(model.pushLabel).toBe('publish branch')
    expect(blockedReasonText('dirty')).toBe('there are uncommitted changes')
    expect(
      reviewPrimaryAction(
        {
          provider: 'github',
          review: null,
          canCreate: true,
          blockedReason: null,
          nextAction: null,
          defaultBaseRef: 'main',
          head: 'f',
          title: '',
          body: ''
        },
        false
      ).label
    ).toBe('create PR')
  })
})
