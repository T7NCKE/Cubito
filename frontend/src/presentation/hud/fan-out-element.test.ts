import { plainFailure } from '../../application/i18n/user-facing-error'
import { describe, expect, it, vi } from 'vitest'
import { createFanOutForm } from './fan-out-element'
import type { FanOutFormViewModel, FanOutRunningViewModel } from './fan-out-view-model'

type FakeElement = {
  tagName: string
  readonly style: Record<string, string>
  readonly children: FakeElement[]
  className: string
  textContent: string
  value: string
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
      for (const cb of listeners[type] ?? []) cb({ target: el, ...event })
    }
  }
  return el
}

const createFakeDocument = (): Document =>
  ({ createElement: (tag: string) => createFakeElement(tag) }) as unknown as Document

const formModel = (overrides: Partial<FanOutFormViewModel> = {}): FanOutFormViewModel => ({
  view: 'form',
  title: 'fan-out · desde main',
  count: { value: 3, min: 2, max: 8, enabled: true },
  agent: { value: 'none', enabled: true },
  prompt: { value: '', enabled: false },
  submitEnabled: false,
  errorMessage: null,
  setupHint: null,
  ...overrides
})

const runningModel = (overrides: Partial<FanOutRunningViewModel> = {}): FanOutRunningViewModel => ({
  view: 'running',
  callout: 'fan-out · 5 × claude',
  counters: '2 trabajando · 1 esperando · 1 naciendo · 1 listo',
  gates: [],
  questions: [],
  failures: [],
  ...overrides
})

const countInputOf = (root: FakeElement): FakeElement =>
  root.children.find((c) => c.tagName === 'INPUT' && c.className.includes('count'))!

describe('createFanOutForm — form view', () => {
  it('labels every agent option with localized copy while keeping the values', () => {
    const form = createFanOutForm(createFakeDocument())
    const select = (form.element as unknown as FakeElement).children.find(
      (c) => c.tagName === 'SELECT'
    )!
    expect(select.children.map((o) => [o.value, o.textContent])).toEqual([
      ['none', 'ninguno'],
      ['claude', 'claude']
    ])
  })

  it('apply() renders the form title and hides it in the running view', () => {
    const form = createFanOutForm(createFakeDocument())
    const root = form.element as unknown as FakeElement
    const title = root.children.find((c) => c.className.includes('title'))!
    form.apply(formModel({ title: 'fan-out · desde feat/x' }))
    expect(title.textContent).toBe('fan-out · desde feat/x')
    form.apply(runningModel())
    expect(title.style.display).toBe('none')
  })

  it('apply() shows the setup notice only when the model carries a hint', () => {
    const form = createFanOutForm(createFakeDocument())
    const root = form.element as unknown as FakeElement
    const notice = root.children.find((c) => c.className.includes('notice'))!
    form.apply(formModel({ setupHint: 'sin setup' }))
    expect(notice.textContent).toBe('sin setup')
    expect(notice.style.display).toBe('')
    form.apply(formModel())
    expect(notice.style.display).toBe('none')
  })

  it('apply() writes count/agent/prompt values and enablement from the model', () => {
    const form = createFanOutForm(createFakeDocument())
    form.apply(
      formModel({
        count: { value: 6, min: 2, max: 8, enabled: true },
        agent: { value: 'claude', enabled: true },
        prompt: { value: 'hola', enabled: true }
      })
    )
    const root = form.element as unknown as FakeElement
    const countInput = countInputOf(root)
    const agentSelect = root.children.find((c) => c.tagName === 'SELECT')!
    const promptArea = root.children.find((c) => c.tagName === 'TEXTAREA')!
    expect(countInput.value).toBe('6')
    expect(agentSelect.value).toBe('claude')
    expect(promptArea.value).toBe('hola')
    expect(promptArea.disabled).toBe(false)
  })

  it('disables PROMPT when the model says it is disabled', () => {
    const form = createFanOutForm(createFakeDocument())
    form.apply(formModel())
    const root = form.element as unknown as FakeElement
    const promptArea = root.children.find((c) => c.tagName === 'TEXTAREA')!
    expect(promptArea.disabled).toBe(true)
  })

  it('disables the submit button when the model says submitEnabled is false', () => {
    const form = createFanOutForm(createFakeDocument())
    form.apply(formModel({ submitEnabled: false }))
    const root = form.element as unknown as FakeElement
    const submitButton = root.children.find(
      (c) => c.tagName === 'BUTTON' && !c.className.includes('cancel')
    )!
    expect(submitButton.disabled).toBe(true)
  })

  it('changing the count field fires onCountChange with a parsed number', () => {
    const form = createFanOutForm(createFakeDocument())
    form.apply(formModel())
    const onCountChange = vi.fn()
    form.onCountChange(onCountChange)
    const root = form.element as unknown as FakeElement
    const countInput = countInputOf(root)
    countInput.value = '5'
    countInput.fire('input')
    expect(onCountChange).toHaveBeenCalledWith(5)
  })

  it('choosing an agent fires onAgentChange', () => {
    const form = createFanOutForm(createFakeDocument())
    form.apply(formModel())
    const onAgentChange = vi.fn()
    form.onAgentChange(onAgentChange)
    const root = form.element as unknown as FakeElement
    const agentSelect = root.children.find((c) => c.tagName === 'SELECT')!
    agentSelect.value = 'claude'
    agentSelect.fire('change')
    expect(onAgentChange).toHaveBeenCalledWith('claude')
  })

  it('typing in the prompt fires onPromptChange', () => {
    const form = createFanOutForm(createFakeDocument())
    form.apply(formModel({ prompt: { value: '', enabled: true } }))
    const onPromptChange = vi.fn()
    form.onPromptChange(onPromptChange)
    const root = form.element as unknown as FakeElement
    const promptArea = root.children.find((c) => c.tagName === 'TEXTAREA')!
    promptArea.value = 'nuevo prompt'
    promptArea.fire('input')
    expect(onPromptChange).toHaveBeenCalledWith('nuevo prompt')
  })

  it('clicking submit fires onSubmit', () => {
    const form = createFanOutForm(createFakeDocument())
    form.apply(formModel({ submitEnabled: true }))
    const onSubmit = vi.fn()
    form.onSubmit(onSubmit)
    const root = form.element as unknown as FakeElement
    const submitButton = root.children.find(
      (c) => c.tagName === 'BUTTON' && !c.className.includes('cancel')
    )!
    submitButton.fire('click')
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('clicking cancel fires onCancel', () => {
    const form = createFanOutForm(createFakeDocument())
    form.apply(formModel())
    const onCancel = vi.fn()
    form.onCancel(onCancel)
    const root = form.element as unknown as FakeElement
    const cancelButton = root.children.find((c) => c.className.includes('cancel'))!
    cancelButton.fire('click')
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('shows the error message when present', () => {
    const form = createFanOutForm(createFakeDocument())
    form.apply(formModel({ errorMessage: plainFailure('a repo must be selected') }))
    const root = form.element as unknown as FakeElement
    const errorEl = root.children.find((c) => c.className.includes('error'))!
    expect(errorEl.textContent).toBe('a repo must be selected')
  })

  it('focusFirstField() focuses the count field', () => {
    const form = createFanOutForm(createFakeDocument())
    form.apply(formModel())
    const root = form.element as unknown as FakeElement
    const countInput = countInputOf(root)
    let focused = false
    countInput.focus = () => (focused = true)
    form.focusFirstField()
    expect(focused).toBe(true)
  })
})

describe('createFanOutForm — running view', () => {
  it('apply() renders the callout and counters lines', () => {
    const form = createFanOutForm(createFakeDocument())
    form.apply(runningModel())
    const root = form.element as unknown as FakeElement
    const callout = root.children.find((c) => c.className.includes('callout'))!
    const counters = root.children.find((c) => c.className.includes('counters'))!
    expect(callout.textContent).toBe('fan-out · 5 × claude')
    expect(counters.textContent).toBe('2 trabajando · 1 esperando · 1 naciendo · 1 listo')
  })
})

describe('createFanOutForm — running view — per-child failures', () => {
  it('renders one row per failure, with the child label and message', () => {
    const form = createFanOutForm(createFakeDocument())
    form.apply(
      runningModel({
        failures: [
          { mutationId: 'm1', label: 'fanout-m1', message: plainFailure('network unreachable') },
          { mutationId: 'm3', label: 'fanout-m3', message: plainFailure('timeout') }
        ]
      })
    )
    const root = form.element as unknown as FakeElement
    const failuresContainer = root.children.find((c) => c.className.includes('failures'))!
    expect(failuresContainer.children).toHaveLength(2)
    expect(failuresContainer.children[0]!.textContent).toContain('fanout-m1')
    expect(failuresContainer.children[0]!.textContent).toContain('network unreachable')
    expect(failuresContainer.children[1]!.textContent).toContain('fanout-m3')
    expect(failuresContainer.children[1]!.textContent).toContain('timeout')
  })

  it('rebuilds the failure rows from scratch on every apply()', () => {
    const form = createFanOutForm(createFakeDocument())
    form.apply(
      runningModel({
        failures: [{ mutationId: 'm1', label: 'fanout-m1', message: plainFailure('boom') }]
      })
    )
    form.apply(runningModel({ failures: [] }))
    const root = form.element as unknown as FakeElement
    const failuresContainer = root.children.find((c) => c.className.includes('failures'))!
    expect(failuresContainer.children).toHaveLength(0)
  })
})

describe('createFanOutForm — dispose', () => {
  it('removes the root element', () => {
    const form = createFanOutForm(createFakeDocument())
    const root = form.element as unknown as FakeElement
    let removed = false
    root.remove = () => (removed = true)
    form.dispose()
    expect(removed).toBe(true)
  })
})

describe('createFanOutForm — keyboard', () => {
  const press = (
    form: ReturnType<typeof createFanOutForm>,
    key: string,
    tagName: string
  ): { stopPropagation: ReturnType<typeof vi.fn> } => {
    const stopPropagation = vi.fn()
    ;(form.element as unknown as FakeElement).fire('keydown', {
      key,
      target: { tagName },
      stopPropagation
    })
    return { stopPropagation }
  }

  it('Escape in the form cancels and does not reach the global shortcuts', () => {
    const form = createFanOutForm(createFakeDocument())
    form.apply(formModel())
    const onCancel = vi.fn()
    form.onCancel(onCancel)
    const { stopPropagation } = press(form, 'Escape', 'INPUT')
    expect(onCancel).toHaveBeenCalledOnce()
    expect(stopPropagation).toHaveBeenCalledOnce()
  })

  it('Enter submits from the count and agent fields but never from PROMPT or a button', () => {
    const form = createFanOutForm(createFakeDocument())
    form.apply(formModel())
    const onSubmit = vi.fn()
    form.onSubmit(onSubmit)
    press(form, 'Enter', 'TEXTAREA')
    press(form, 'Enter', 'BUTTON')
    expect(onSubmit).not.toHaveBeenCalled()
    press(form, 'Enter', 'INPUT')
    press(form, 'Enter', 'SELECT')
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it('Escape dismisses the running panel too, but Enter never submits there', () => {
    const form = createFanOutForm(createFakeDocument())
    form.apply(runningModel())
    const onCancel = vi.fn()
    const onSubmit = vi.fn()
    form.onCancel(onCancel)
    form.onSubmit(onSubmit)
    press(form, 'Enter', 'INPUT')
    expect(onSubmit).not.toHaveBeenCalled()
    press(form, 'Escape', 'INPUT')
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
