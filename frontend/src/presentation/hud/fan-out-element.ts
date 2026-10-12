import type { SpawnAgent } from '../../application/ports/runtime-gateway'
import type { FanOutFormViewModel, FanOutRunningViewModel } from './fan-out-view-model'
import { createFanOutGateList } from './fan-out-gate-list-element'
import { t } from '../../application/i18n/translate'
import { renderFailureText } from '../failure-text-element'
import { AGENT_OPTIONS, agentOptionLabel } from './spawn-agent-options'
import { resolveSpawnFormKey } from './spawn-form-element'
import { createFormFieldLabel } from './form-field-label'

export type FanOutFormHandle = {
  readonly element: HTMLElement
  apply(model: FanOutFormViewModel | FanOutRunningViewModel): void
  onCountChange(callback: (count: number) => void): () => void
  onAgentChange(callback: (agent: SpawnAgent) => void): () => void
  onPromptChange(callback: (prompt: string) => void): () => void
  onSubmit(callback: () => void): () => void
  onCancel(callback: () => void): () => void
  /** Running panel only: hide it without touching the litter. */
  onDismiss(callback: () => void): () => void
  setVisible(visible: boolean): void
  onResolveGate(callback: (gateId: string, resolution: string) => void | Promise<void>): () => void
  onAnswerQuestion(callback: (messageId: string, body: string) => void | Promise<void>): () => void
  focusFirstField(): void
  dispose(): void
}

/**
 * HUD-anchored fan-out form/running panel (mirrors spawn-form-element.ts): one `<div>` panel
 * built with an injectable `doc`, that renders the form fields while `view === 'form'` and the
 * running callout+counters while `view === 'running'` — a single element for both, since the
 * fan-out slice never has a separate radial step the way spawn does.
 */
export function createFanOutForm(doc: Document = document): FanOutFormHandle {
  const root = doc.createElement('div')
  root.className = 'cubito-fanout-form'
  root.style.pointerEvents = 'auto'

  const countInput = doc.createElement('input')
  countInput.className = 'cubito-fanout-form__field cubito-fanout-form__field--count'
  ;(countInput as unknown as { type: string }).type = 'number'

  const agentSelect = doc.createElement('select')
  agentSelect.className = 'cubito-fanout-form__field cubito-fanout-form__field--agent'
  for (const agent of AGENT_OPTIONS) {
    const option = doc.createElement('option')
    option.textContent = agentOptionLabel(agent)
    ;(option as unknown as HTMLOptionElement).value = agent
    agentSelect.appendChild(option)
  }

  const promptArea = doc.createElement('textarea')
  promptArea.className = 'cubito-fanout-form__field cubito-fanout-form__field--prompt'

  const submitButton = doc.createElement('button')
  submitButton.className = 'cubito-fanout-form__submit'
  submitButton.textContent = t('fanout.submit')

  const cancelButton = doc.createElement('button')
  cancelButton.className = 'cubito-fanout-form__cancel'
  cancelButton.textContent = t('fanout.cancel')

  const dismissButton = doc.createElement('button')
  dismissButton.className = 'cubito-fanout-form__dismiss'
  dismissButton.textContent = t('fanout.dismiss')

  const title = doc.createElement('div')
  title.className = 'cubito-fanout-form__title'

  const errorLine = doc.createElement('div')
  errorLine.className = 'cubito-fanout-form__error'

  const setupNotice = doc.createElement('div')
  setupNotice.className = 'cubito-fanout-form__notice'

  const callout = doc.createElement('div')
  callout.className = 'cubito-fanout-form__callout'

  const counters = doc.createElement('div')
  counters.className = 'cubito-fanout-form__counters'

  const failuresList = doc.createElement('div')
  failuresList.className = 'cubito-fanout-form__failures'

  const gateList = createFanOutGateList(doc)

  promptArea.placeholder = t('fanout.placeholder.prompt')
  const labelOf = (key: Parameters<typeof t>[0], field: HTMLElement): HTMLElement =>
    createFormFieldLabel(doc, 'cubito-form-label', t(key), field)
  const countLabel = labelOf('fanout.label.count', countInput)
  const agentLabel = labelOf('fanout.label.agent', agentSelect)
  const promptLabel = labelOf('fanout.label.prompt', promptArea)

  for (const child of [
    title,
    countLabel,
    countInput,
    agentLabel,
    agentSelect,
    promptLabel,
    promptArea,
    errorLine,
    setupNotice,
    submitButton,
    cancelButton,
    callout,
    dismissButton,
    counters,
    failuresList
  ]) {
    root.appendChild(child)
  }
  root.appendChild(gateList.element)

  let countChangeCallback: ((count: number) => void) | null = null
  let agentChangeCallback: ((agent: SpawnAgent) => void) | null = null
  let promptChangeCallback: ((prompt: string) => void) | null = null
  let submitCallback: (() => void) | null = null
  let cancelCallback: (() => void) | null = null
  let dismissCallback: (() => void) | null = null

  countInput.addEventListener('input', (event) => {
    const value = Number((event.target as unknown as { value: string }).value)
    countChangeCallback?.(value)
  })
  agentSelect.addEventListener('change', (event) => {
    agentChangeCallback?.((event.target as unknown as { value: SpawnAgent }).value)
  })
  promptArea.addEventListener('input', (event) => {
    promptChangeCallback?.((event.target as unknown as { value: string }).value)
  })
  submitButton.addEventListener('click', () => submitCallback?.())
  cancelButton.addEventListener('click', () => cancelCallback?.())
  dismissButton.addEventListener('click', () => dismissCallback?.())

  // Same keys as the spawn form; the running panel only honours Escape (it has no submit).
  let formVisible = true
  root.addEventListener('keydown', (event) => {
    const keyEvent = event as KeyboardEvent
    const action = resolveSpawnFormKey({
      key: keyEvent.key,
      tagName: (event.target as unknown as { tagName: string }).tagName
    })
    if (action === null || (action === 'submit' && !formVisible)) return
    keyEvent.stopPropagation()
    if (action === 'submit') submitCallback?.()
    else if (formVisible) cancelCallback?.()
    else dismissCallback?.()
  })

  const showFields = (visible: boolean): void => {
    const display = visible ? '' : 'none'
    title.style.display = display
    for (const label of [countLabel, agentLabel, promptLabel]) label.style.display = display
    countInput.style.display = display
    agentSelect.style.display = display
    promptArea.style.display = display
    errorLine.style.display = visible && errorLine.textContent !== '' ? '' : 'none'
    setupNotice.style.display = visible && setupNotice.textContent !== '' ? '' : 'none'
    submitButton.style.display = display
    cancelButton.style.display = display
  }

  const showRunning = (visible: boolean): void => {
    const display = visible ? '' : 'none'
    callout.style.display = display
    dismissButton.style.display = display
    counters.style.display = display
    failuresList.style.display = display
    gateList.element.style.display = display
  }

  // Terminal entries, rebuilt on every apply() (mirrors gate-list's simpler siblings) — no
  // reconciliation needed since a failed child never un-fails.
  const renderFailures = (failures: FanOutRunningViewModel['failures']): void => {
    failuresList.replaceChildren()
    for (const failure of failures) {
      const row = doc.createElement('div')
      row.className = 'cubito-fanout-form__failure'
      renderFailureText(doc, row, failure.message, `${failure.label}: `)
      failuresList.appendChild(row)
    }
  }

  return {
    element: root,
    apply(model: FanOutFormViewModel | FanOutRunningViewModel) {
      formVisible = model.view === 'form'
      if (model.view === 'form') {
        showFields(true)
        showRunning(false)
        title.textContent = model.title
        countInput.value = String(model.count.value)
        ;(countInput as unknown as { min: string }).min = String(model.count.min)
        ;(countInput as unknown as { max: string }).max = String(model.count.max)
        countInput.disabled = !model.count.enabled
        agentSelect.value = model.agent.value
        agentSelect.disabled = !model.agent.enabled
        promptArea.value = model.prompt.value
        promptArea.disabled = !model.prompt.enabled
        submitButton.disabled = !model.submitEnabled
        renderFailureText(doc, errorLine, model.errorMessage)
        errorLine.style.display = model.errorMessage === null ? 'none' : ''
        setupNotice.textContent = model.setupHint ?? ''
        setupNotice.style.display = model.setupHint === null ? 'none' : ''
        return
      }
      showFields(false)
      showRunning(true)
      callout.textContent = model.callout
      counters.textContent = model.counters
      renderFailures(model.failures)
      gateList.apply({ gates: model.gates, questions: model.questions })
    },
    onCountChange(callback) {
      countChangeCallback = callback
      return () => (countChangeCallback = null)
    },
    onAgentChange(callback) {
      agentChangeCallback = callback
      return () => (agentChangeCallback = null)
    },
    onPromptChange(callback) {
      promptChangeCallback = callback
      return () => (promptChangeCallback = null)
    },
    onSubmit(callback) {
      submitCallback = callback
      return () => (submitCallback = null)
    },
    onCancel(callback) {
      cancelCallback = callback
      return () => (cancelCallback = null)
    },
    onDismiss(callback) {
      dismissCallback = callback
      return () => (dismissCallback = null)
    },
    setVisible(visible) {
      root.hidden = !visible
    },
    onResolveGate(callback) {
      return gateList.onResolveGate(callback)
    },
    onAnswerQuestion(callback) {
      return gateList.onAnswerQuestion(callback)
    },
    focusFirstField() {
      countInput.focus()
    },
    dispose() {
      gateList.dispose()
      root.remove()
    }
  }
}
