import { plainFailure } from '../../application/i18n/user-facing-error'
import { describe, expect, it } from 'vitest'
import { createCompareMergeAction } from './compare-merge-action-element'
import type { CompareMergeActionModel } from './compare-merge-action-element'
import type { CompareMergeState } from '../../application/compare-view-model'

type Handler = (event: { key?: string }) => void

type FakeElement = {
  tagName: string
  type: string
  hidden: boolean
  disabled: boolean
  checked: boolean
  blurCount: number
  readonly children: FakeElement[]
  className: string
  textContent: string
  appendChild(child: FakeElement): FakeElement
  replaceChildren(): void
  remove(): void
  addEventListener(type: string, handler: Handler): void
  dispatch(type: string, event?: { key?: string }): void
  blur(): void
}

const createFakeElement = (tag: string): FakeElement => {
  const handlers: Record<string, Handler> = {}
  const el: FakeElement = {
    tagName: tag.toUpperCase(),
    type: '',
    hidden: false,
    disabled: false,
    checked: false,
    blurCount: 0,
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
    remove() {},
    addEventListener(type, handler) {
      handlers[type] = handler
    },
    dispatch(type, event = {}) {
      handlers[type]?.(event)
    },
    blur() {
      el.blurCount++
    }
  }
  return el
}

const createFakeDocument = (): Document =>
  ({ createElement: (tag: string) => createFakeElement(tag) }) as unknown as Document

const rootOf = (handle: ReturnType<typeof createCompareMergeAction>) =>
  handle.root as unknown as FakeElement
const buttonOf = (root: FakeElement) => root.children[0]!
const syncRowOf = (root: FakeElement) => root.children[1]!
const syncCheckboxOf = (root: FakeElement) => syncRowOf(root).children[0]!
const resultOf = (root: FakeElement) => root.children[2]!

const idle: CompareMergeState = { phase: 'idle' }
const running: CompareMergeState = { phase: 'running' }

const model = (overrides: Partial<CompareMergeActionModel> = {}): CompareMergeActionModel => ({
  visible: true,
  capable: true,
  syncCapable: true,
  merge: idle,
  ...overrides
})

describe('createCompareMergeAction', () => {
  it('is hidden when not visible (no winner picked)', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model({ visible: false }))
    expect(rootOf(action).hidden).toBe(true)
  })

  it('is visible once a winner is picked', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model({ visible: true }))
    expect(rootOf(action).hidden).toBe(false)
  })

  it('disables the button and shows "no soportado" when the host lacks the capability', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model({ capable: false }))
    const button = buttonOf(rootOf(action))
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('no soportado')
  })

  it('shows the idle label when capable and idle', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model())
    expect(buttonOf(rootOf(action)).textContent).toBe('mergear ganador')
  })

  it('first click arms a confirm, without firing onMergeWinner', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model())
    const fired: number[] = []
    action.onMergeWinner(() => fired.push(1))
    buttonOf(rootOf(action)).dispatch('click')
    expect(buttonOf(rootOf(action)).textContent).toBe('confirmar merge')
    expect(fired).toHaveLength(0)
  })

  it('second click fires onMergeWinner (with the checkbox unchecked) and disarms to the idle label', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model())
    const fired: boolean[] = []
    action.onMergeWinner((syncWorkingTree) => fired.push(syncWorkingTree))
    syncCheckboxOf(rootOf(action)).checked = false
    const button = buttonOf(rootOf(action))
    button.dispatch('click')
    button.dispatch('click')
    expect(fired).toEqual([false])
    expect(button.textContent).toBe('mergear ganador')
  })

  it('second click fires onMergeWinner with true by default (sync is on)', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model())
    const fired: boolean[] = []
    action.onMergeWinner((syncWorkingTree) => fired.push(syncWorkingTree))
    const root = rootOf(action)
    const button = buttonOf(root)
    button.dispatch('click')
    button.dispatch('click')
    expect(fired).toEqual([true])
  })

  it('blurs itself after the confirming click (risk 3: a focused button re-fires on Enter, which descend-island would otherwise leave un-prevented)', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model())
    action.onMergeWinner(() => {})
    const button = buttonOf(rootOf(action))
    button.dispatch('click')
    button.dispatch('click')
    expect(button.blurCount).toBe(1)
  })

  it('blur disarms an armed confirm', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model())
    const fired: number[] = []
    action.onMergeWinner(() => fired.push(1))
    const button = buttonOf(rootOf(action))
    button.dispatch('click')
    button.dispatch('blur')
    button.dispatch('click')
    expect(button.textContent).toBe('confirmar merge')
    expect(fired).toHaveLength(0)
  })

  it('Escape disarms an armed confirm', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model())
    const button = buttonOf(rootOf(action))
    button.dispatch('click')
    button.dispatch('keydown', { key: 'Escape' })
    expect(button.textContent).toBe('mergear ganador')
  })

  it('a click while disabled (not capable) neither arms nor fires', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model({ capable: false }))
    const fired: number[] = []
    action.onMergeWinner(() => fired.push(1))
    const button = buttonOf(rootOf(action))
    button.dispatch('click')
    button.dispatch('click')
    expect(fired).toHaveLength(0)
    expect(button.textContent).toBe('no soportado')
  })

  it('shows the running label and disables the button while merging', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model({ merge: running }))
    const button = buttonOf(rootOf(action))
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('mergeando…')
  })

  it('renders the R1-aware success copy on clean, including a short commit oid', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model({ merge: { phase: 'clean', commitOid: 'abcdef1234567' } }))
    const result = resultOf(rootOf(action))
    expect(result.children[0]!.textContent).toContain('Mergeado al padre')
    expect(result.children[0]!.textContent).toContain('abcdef1')
    expect(result.children[0]!.textContent).toContain('git reset --hard')
  })

  it('renders a read-only conflict file-name list', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model({ merge: { phase: 'conflict', files: ['src/a.ts', 'src/b.ts'] } }))
    const result = resultOf(rootOf(action))
    const list = result.children[1]!
    expect(list.tagName).toBe('UL')
    expect(list.children.map((li) => li.textContent)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('renders the error message on error', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model({ merge: { phase: 'error', message: plainFailure('host unavailable') } }))
    const result = resultOf(rootOf(action))
    expect(result.children[0]!.textContent).toBe('host unavailable')
  })

  it('clears the result region back to idle/running', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model({ merge: { phase: 'error', message: plainFailure('x') } }))
    action.apply(model({ merge: idle }))
    expect(resultOf(rootOf(action)).children).toHaveLength(0)
  })

  it('going hidden disarms a pending confirm', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model())
    const button = buttonOf(rootOf(action))
    button.dispatch('click')
    action.apply(model({ visible: false }))
    action.apply(model({ visible: true }))
    expect(button.textContent).toBe('mergear ganador')
  })

  it('sync checkbox row is hidden when the host lacks the sync capability', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model({ syncCapable: false }))
    expect(syncRowOf(rootOf(action)).hidden).toBe(true)
  })

  it('never asks a host without the sync capability to sync, whatever the checkbox says', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model({ syncCapable: false }))
    const fired: boolean[] = []
    action.onMergeWinner((syncWorkingTree) => fired.push(syncWorkingTree))
    const button = buttonOf(rootOf(action))
    button.dispatch('click')
    button.dispatch('click')
    expect(fired).toEqual([false])
  })

  it('sync checkbox row is visible and checked by default when syncCapable', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model({ syncCapable: true }))
    const root = rootOf(action)
    expect(syncRowOf(root).hidden).toBe(false)
    expect(syncCheckboxOf(root).checked).toBe(true)
  })

  it('sync checkbox resets to checked when the action goes hidden', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model())
    const root = rootOf(action)
    syncCheckboxOf(root).checked = false
    action.apply(model({ visible: false }))
    action.apply(model({ visible: true }))
    expect(syncCheckboxOf(root).checked).toBe(true)
  })

  it('keeps the button disabled after any successful merge until a new winner resets the phase', () => {
    const action = createCompareMergeAction(createFakeDocument())
    const root = rootOf(action)
    for (const workingTree of [
      undefined,
      { status: 'synced' as const },
      { status: 'failed' as const, message: 'x' },
      { status: 'skipped' as const, reason: 'dirty' as const }
    ]) {
      action.apply(
        model({
          merge: {
            phase: 'clean',
            commitOid: 'abcdef1',
            ...(workingTree === undefined ? {} : { workingTree })
          }
        })
      )
      expect(buttonOf(root).disabled).toBe(true)
    }
    action.apply(model({ merge: idle }))
    expect(buttonOf(root).disabled).toBe(false)
  })

  it('renders "padre sincronizado" for a synced workingTree', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(
      model({ merge: { phase: 'clean', commitOid: 'abcdef1', workingTree: { status: 'synced' } } })
    )
    const result = resultOf(rootOf(action))
    expect(result.children[0]!.textContent).toContain('padre sincronizado')
    expect(result.children[0]!.textContent).toContain('abcdef1')
  })

  it("renders an older host's skipped/dirty sync as merged-unsynced, keeping the oid", () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(
      model({
        merge: {
          phase: 'clean',
          commitOid: 'abcdef1234',
          workingTree: { status: 'skipped', reason: 'dirty' }
        }
      })
    )
    const result = resultOf(rootOf(action))
    expect(result.children[0]!.className).toContain('--warning')
    expect(result.children[0]!.textContent).toContain('abcdef1')
    expect(result.children[0]!.children[0]!.textContent).toContain('tiene cambios sin commitear')
    expect(result.children[1]!.textContent).toContain('git reset --soft abcdef1^1')
  })

  it('renders merged-unsynced with the detail and recovery steps from previousOid', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(
      model({
        merge: {
          phase: 'clean',
          commitOid: 'abcdef1234',
          workingTree: {
            status: 'failed',
            message: 'refusing to clobber x.txt',
            previousOid: '1234567890'
          }
        }
      })
    )
    const result = resultOf(rootOf(action))
    expect(result.children[0]!.textContent).toContain('abcdef1')
    expect(result.children[0]!.textContent).toContain('no se actualizaron')
    expect(result.children[0]!.children[0]).toMatchObject({
      className: 'cubito-failure__detail',
      textContent: 'refusing to clobber x.txt'
    })
    expect(result.children[1]!.textContent).toContain('git reset --soft 1234567')
    expect(result.children[1]!.textContent).toContain('git read-tree -u -m 1234567 HEAD')
  })

  it('renders a blocked untracked-overwrite lead with the path list, button still usable', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(
      model({
        merge: { phase: 'blocked', reason: 'untracked-overwrite', paths: ['new.txt', 'dir/'] }
      })
    )
    const root = rootOf(action)
    const result = resultOf(root)
    expect(result.children[0]!.textContent).toContain('archivos que el ganador sobrescribiría')
    expect(result.children[1]!.children.map((li) => li.textContent)).toEqual(['new.txt', 'dir/'])
    expect(buttonOf(root).disabled).toBe(false)
  })

  it('renders a blocked sync failure with its git detail', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(
      model({
        merge: { phase: 'blocked', reason: 'sync-failed', paths: [], message: 'error: boom' }
      })
    )
    const result = resultOf(rootOf(action))
    expect(result.children[0]!.textContent).toContain('no se mergeó nada')
    expect(result.children[0]!.children[0]!.textContent).toBe('error: boom')
    expect(result.children).toHaveLength(1)
  })

  it('renders already-merged as info and does not re-arm the button', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model({ merge: { phase: 'already-merged', commitOid: 'abcdef1234' } }))
    const root = rootOf(action)
    expect(resultOf(root).children[0]!.textContent).toContain('ya contiene')
    expect(resultOf(root).children[0]!.textContent).toContain('abcdef1')
    expect(buttonOf(root).disabled).toBe(true)
  })

  it('adds a background dependency-setup line only when started', () => {
    const action = createCompareMergeAction(createFakeDocument())
    const result = resultOf(rootOf(action))
    action.apply(
      model({
        merge: {
          phase: 'clean',
          commitOid: 'abcdef1',
          workingTree: { status: 'synced' },
          dependencySetup: { status: 'started' }
        }
      })
    )
    expect(result.children[1]!.textContent).toContain('segundo plano')
    action.apply(
      model({ merge: { phase: 'clean', commitOid: 'abcdef1', workingTree: { status: 'synced' } } })
    )
    expect(result.children).toHaveLength(1)
  })

  it('renders the unchanged R1 copy when workingTree is absent', () => {
    const action = createCompareMergeAction(createFakeDocument())
    action.apply(model({ merge: { phase: 'clean', commitOid: 'abcdef1234567' } }))
    const result = resultOf(rootOf(action))
    expect(result.children[0]!.textContent).toContain('git read-tree -u -m abcdef1^1 HEAD')
    expect(result.children[0]!.textContent).toContain('git reset --hard')
  })

  it('dispose removes the root element', () => {
    const action = createCompareMergeAction(createFakeDocument())
    const root = rootOf(action)
    let removed = false
    root.remove = () => (removed = true)
    action.dispose()
    expect(removed).toBe(true)
  })
})
