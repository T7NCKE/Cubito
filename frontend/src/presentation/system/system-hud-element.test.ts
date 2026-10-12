import { afterEach, describe, expect, it } from 'vitest'
import { setActiveLanguage } from '../../application/i18n/translate'
import { createSystemHud } from './system-hud-element'
import type { ConnectionState } from '../../application/scene-store'

type FakeElement = {
  tagName: string
  readonly style: Record<string, string>
  readonly children: FakeElement[]
  readonly dataset: Record<string, string>
  className: string
  textContent: string
  hidden: boolean
  appendChild(child: FakeElement): FakeElement
  replaceChildren(): void
  remove(): void
}

const createFakeElement = (tag: string): FakeElement => {
  const el: FakeElement = {
    tagName: tag.toUpperCase(),
    style: {},
    children: [],
    dataset: {},
    className: '',
    textContent: '',
    hidden: false,
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

let created: FakeElement[] = []
const createFakeDocument = (): Document =>
  ({
    createElement: (tag: string) => {
      const el = createFakeElement(tag)
      created.push(el)
      return el
    }
  }) as unknown as Document

const rootOf = (handle: ReturnType<typeof createSystemHud>) => handle.root as unknown as FakeElement
const connectionLineOf = (root: FakeElement) => root.children[0]!
const modeLineOf = (root: FakeElement) => root.children[1]!
const countersLineOf = (root: FakeElement) => root.children[2]!

const connected = (runtimeId = '4f2a9c'): ConnectionState => ({ state: 'connected', runtimeId })

describe('createSystemHud', () => {
  afterEach(() => setActiveLanguage('es'))

  it('renders the English mode, editing label and counters when the language is en', () => {
    setActiveLanguage('en')
    created = []
    const hud = createSystemHud(createFakeDocument())
    hud.apply({
      connection: connected(),
      branch: 'cubito/auth-retry',
      counts: { tocados: 2, nuevo: 1 },
      source: 'stream'
    })
    const root = rootOf(hud)
    expect(modeLineOf(root).textContent).toBe('cubito/auth-retry · live system')
    expect(countersLineOf(root).children[0]!.textContent).toBe('claude editing')
    expect(countersLineOf(root).children[1]!.textContent).toBe(' · 2 endpoints touched · 1 new')
  })

  it('renders the three HUD lines with the expected text', () => {
    created = []
    const hud = createSystemHud(createFakeDocument())
    hud.apply({
      connection: connected(),
      branch: 'cubito/auth-retry',
      counts: { tocados: 2, nuevo: 1 },
      source: 'stream'
    })
    const root = rootOf(hud)
    expect(connectionLineOf(root).children[1]!.textContent).toBe('conectado · runtime 4f2a9c')
    expect(modeLineOf(root).textContent).toBe('cubito/auth-retry · sistema en vivo')
    expect(countersLineOf(root).children[0]!.textContent).toBe('claude editando')
    expect(countersLineOf(root).children[1]!.textContent).toBe(' · 2 endpoints tocados · 1 nuevo')
  })

  it('drops the "claude editing" label and its separator when no agent is active', () => {
    created = []
    const hud = createSystemHud(createFakeDocument())
    hud.apply({
      connection: connected(),
      branch: 'b',
      counts: { tocados: 0, nuevo: 0 },
      source: 'poll',
      agentActive: false
    })
    const line = countersLineOf(rootOf(hud))
    expect(line.children[0]!.hidden).toBe(true)
    expect(line.children[1]!.textContent).toBe('0 endpoints tocados · 0 nuevos')
  })

  it('substitutes tocados/nuevo counts on line 3', () => {
    created = []
    const hud = createSystemHud(createFakeDocument())
    hud.apply({
      connection: connected(),
      branch: 'b',
      counts: { tocados: 0, nuevo: 5 },
      source: 'poll'
    })
    expect(countersLineOf(rootOf(hud)).children[1]!.textContent).toBe(
      ' · 0 endpoints tocados · 5 nuevos'
    )
  })

  it('sets the connection dot color via a --cubito-* var, per connection state', () => {
    created = []
    const hud = createSystemHud(createFakeDocument())
    const dot = connectionLineOf(rootOf(hud)).children[0]!

    hud.apply({
      connection: connected(),
      branch: 'b',
      counts: { tocados: 0, nuevo: 0 },
      source: 'poll'
    })
    expect(dot.style.backgroundColor).toBe('var(--cubito-accent)')

    hud.apply({
      connection: { state: 'connecting' },
      branch: 'b',
      counts: { tocados: 0, nuevo: 0 },
      source: 'poll'
    })
    expect(dot.style.backgroundColor).toBe('var(--cubito-amber)')

    hud.apply({
      connection: { state: 'down', reason: 'timeout' },
      branch: 'b',
      counts: { tocados: 0, nuevo: 0 },
      source: 'poll'
    })
    expect(dot.style.backgroundColor).toBe('var(--cubito-amber-dim)')
  })

  it('sets root.dataset.source to the HUD model source (stream/poll/demo)', () => {
    created = []
    const hud = createSystemHud(createFakeDocument())
    const root = rootOf(hud)

    hud.apply({
      connection: connected(),
      branch: 'b',
      counts: { tocados: 0, nuevo: 0 },
      source: 'stream'
    })
    expect(root.dataset.source).toBe('stream')

    hud.apply({
      connection: connected(),
      branch: 'b',
      counts: { tocados: 0, nuevo: 0 },
      source: 'poll'
    })
    expect(root.dataset.source).toBe('poll')

    hud.apply({
      connection: connected(),
      branch: 'b',
      counts: { tocados: 0, nuevo: 0 },
      source: 'demo'
    })
    expect(root.dataset.source).toBe('demo')
  })

  it('renders the shared [g][x][d][c][t] mode switcher, separate from the root', () => {
    created = []
    const hud = createSystemHud(createFakeDocument())
    expect(hud.keyboardBar.root).not.toBe(hud.root)
    const bar = hud.keyboardBar.root as unknown as FakeElement
    expect(bar.children).toHaveLength(5)
    const keys = bar.children.map((chip) => chip.children[0]!.textContent)
    expect(keys).toEqual(['g', 'x', 'd', 'c', 't'])
  })

  it('dispose removes the root and disposes the keyboard bar', () => {
    created = []
    const hud = createSystemHud(createFakeDocument())
    const root = rootOf(hud)
    const bar = hud.keyboardBar.root as unknown as FakeElement
    let rootRemoved = false
    let barRemoved = false
    root.remove = () => (rootRemoved = true)
    bar.remove = () => (barRemoved = true)
    hud.dispose()
    expect(rootRemoved).toBe(true)
    expect(barRemoved).toBe(true)
  })
})
