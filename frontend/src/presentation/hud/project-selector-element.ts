import { t } from '../../application/i18n/translate'
import type { FailureMessage } from '../../application/i18n/user-facing-error'
import { renderFailureText } from '../failure-text-element'
import type {
  ProjectSelectorListViewModel,
  ProjectSelectorAddFormViewModel
} from './project-selector-view-model'

export type ProjectSelectorPanelModel =
  | ProjectSelectorListViewModel
  | ProjectSelectorAddFormViewModel

/** List-view keys: ↑↓ and Tab cycle the highlight, Enter activates it, Escape closes. */
export type ListKeyAction =
  | { type: 'highlight'; delta: number }
  | { type: 'activate' }
  | { type: 'close' }
/** Add-form keys: Escape backs out to the list, Enter submits from any field but the textarea-less path field. */
export type AddFormKeyAction = { type: 'submit' } | { type: 'cancel' }

/** Pure key resolver (mirrors resolveSpawnFormKey) — the element's own keydown never competes
 *  with the global keyboard-controller because the query input is a text-entry target. */
export function resolveProjectSelectorKey(
  view: 'list' | 'add-form',
  key: string
): ListKeyAction | AddFormKeyAction | null {
  if (view === 'list') {
    if (key === 'ArrowDown' || key === 'Tab') return { type: 'highlight', delta: 1 }
    if (key === 'ArrowUp') return { type: 'highlight', delta: -1 }
    if (key === 'Enter') return { type: 'activate' }
    if (key === 'Escape') return { type: 'close' }
    return null
  }
  if (key === 'Escape') return { type: 'cancel' }
  if (key === 'Enter') return { type: 'submit' }
  return null
}

/** Setup-command editor for the active repo, shown under the list; `command` null = no setup. */
export type ProjectSelectorSetupModel = {
  readonly repoName: string
  readonly command: string | null
  /** Read-only command coming from orca.yaml; not editable or clearable from here. */
  readonly sharedCommand?: string | null
  readonly message: FailureMessage | null
}

export type ProjectSelectorHandle = {
  readonly element: HTMLElement
  apply(model: ProjectSelectorPanelModel): void
  onQueryChange(callback: (query: string) => void): () => void
  onHighlight(callback: (delta: number) => void): () => void
  onActivate(callback: (repoId: string) => void): () => void
  onOpenAddForm(callback: () => void): () => void
  onClose(callback: () => void): () => void
  onAddFieldChange(callback: (field: 'path' | 'kind' | 'setup', value: string) => void): () => void
  /** `null` hides the setup section (no active repo / still loading). */
  applySetup(model: ProjectSelectorSetupModel | null): void
  onSetupSave(callback: (command: string) => void): () => void
  onAddSubmit(callback: () => void): () => void
  onAddCancel(callback: () => void): () => void
  focusQuery(): void
  focusPath(): void
  dispose(): void
}

const KIND_OPTIONS = ['git', 'folder'] as const

/**
 * ⌘P command-palette panel (design Area 4/PROJ-005/006) — a fixed HUD `<div>` built like
 * spawn-form-element.ts with an injectable `doc`. Toggles between the list section and the
 * add-form section by `model.view`; owns its own keydown so Escape/Enter/↑↓/Tab never compete
 * with the graph's keyboard-controller while the query input or a field is focused.
 */
export function createProjectSelector(doc: Document = document): ProjectSelectorHandle {
  const root = doc.createElement('div')
  root.className = 'cubito-project-selector'
  root.style.pointerEvents = 'auto'

  const listSection = doc.createElement('div')
  listSection.className = 'cubito-project-selector__list'

  const queryInput = doc.createElement('input')
  queryInput.className = 'cubito-project-selector__query'

  const rows = doc.createElement('div')
  rows.className = 'cubito-project-selector__rows'

  const addRow = doc.createElement('div')
  addRow.className = 'cubito-project-selector__row cubito-project-selector__row--add'
  addRow.textContent = t('projects.addRow')

  listSection.appendChild(queryInput)
  listSection.appendChild(rows)
  listSection.appendChild(addRow)

  const setupSection = doc.createElement('div')
  setupSection.className = 'cubito-project-selector__setup'
  setupSection.style.display = 'none'
  const setupLabel = doc.createElement('div')
  setupLabel.className = 'cubito-project-selector__notice'
  const setupCommandInput = doc.createElement('input')
  setupCommandInput.className =
    'cubito-project-selector__field cubito-project-selector__field--setup'
  const setupSaveButton = doc.createElement('button')
  setupSaveButton.className = 'cubito-project-selector__cancel'
  setupSaveButton.textContent = t('projects.saveSetup')
  setupSection.appendChild(setupLabel)
  setupSection.appendChild(setupCommandInput)
  setupSection.appendChild(setupSaveButton)
  listSection.appendChild(setupSection)

  const formSection = doc.createElement('div')
  formSection.className = 'cubito-project-selector__form'

  const pathInput = doc.createElement('input')
  pathInput.className = 'cubito-project-selector__field cubito-project-selector__field--path'

  pathInput.placeholder = t('projects.pathPlaceholder')

  const pathHelp = doc.createElement('div')
  pathHelp.className = 'cubito-project-selector__notice'
  pathHelp.textContent = t('projects.pathHelp')

  const kindSelect = doc.createElement('select')
  kindSelect.className = 'cubito-project-selector__field cubito-project-selector__field--kind'
  for (const kind of KIND_OPTIONS) {
    const option = doc.createElement('option')
    option.textContent = kind
    ;(option as unknown as HTMLOptionElement).value = kind
    kindSelect.appendChild(option)
  }

  const setupInput = doc.createElement('input')
  setupInput.className = 'cubito-project-selector__field cubito-project-selector__field--setup'
  setupInput.placeholder = t('projects.setupPlaceholder')

  const submitButton = doc.createElement('button')
  submitButton.className = 'cubito-project-selector__submit'

  const cancelButton = doc.createElement('button')
  cancelButton.className = 'cubito-project-selector__cancel'
  cancelButton.textContent = t('projects.cancel')

  const errorLine = doc.createElement('div')
  errorLine.className = 'cubito-project-selector__error'

  formSection.appendChild(pathInput)
  formSection.appendChild(pathHelp)
  formSection.appendChild(kindSelect)
  formSection.appendChild(setupInput)
  formSection.appendChild(errorLine)
  formSection.appendChild(submitButton)
  formSection.appendChild(cancelButton)

  root.appendChild(listSection)
  root.appendChild(formSection)

  let queryChangeCallback: ((query: string) => void) | null = null
  let highlightCallback: ((delta: number) => void) | null = null
  let activateCallback: ((repoId: string) => void) | null = null
  let openAddFormCallback: (() => void) | null = null
  let closeCallback: (() => void) | null = null
  let addFieldChangeCallback: ((field: 'path' | 'kind' | 'setup', value: string) => void) | null =
    null
  let setupSaveCallback: ((command: string) => void) | null = null
  let addSubmitCallback: (() => void) | null = null
  let addCancelCallback: (() => void) | null = null

  let currentModel: ProjectSelectorPanelModel | null = null

  queryInput.addEventListener('input', () => {
    queryChangeCallback?.((queryInput as unknown as { value: string }).value)
  })

  pathInput.addEventListener('input', () => {
    addFieldChangeCallback?.('path', (pathInput as unknown as { value: string }).value)
  })
  setupInput.addEventListener('input', () => {
    addFieldChangeCallback?.('setup', (setupInput as unknown as { value: string }).value)
  })
  const saveSetup = (): void =>
    setupSaveCallback?.((setupCommandInput as unknown as { value: string }).value)
  setupSaveButton.addEventListener('click', saveSetup)
  // Why: keys typed in the setup field must not reach the list's highlight/activate handler.
  setupCommandInput.addEventListener('keydown', (event) => {
    ;(event as KeyboardEvent).stopPropagation()
    const key = (event as KeyboardEvent).key
    if (key === 'Enter') saveSetup()
    else if (key === 'Escape') closeCallback?.()
  })
  kindSelect.addEventListener('change', () => {
    addFieldChangeCallback?.('kind', (kindSelect as unknown as { value: string }).value)
  })
  addRow.addEventListener('click', () => openAddFormCallback?.())
  submitButton.addEventListener('click', () => addSubmitCallback?.())
  cancelButton.addEventListener('click', () => addCancelCallback?.())

  const activateHighlighted = (): void => {
    if (currentModel?.view !== 'list') return
    if (currentModel.addRowHighlighted) {
      openAddFormCallback?.()
      return
    }
    const highlighted = currentModel.rows.find((row) => row.highlighted)
    if (highlighted) activateCallback?.(highlighted.repoId)
  }

  root.addEventListener('keydown', (event) => {
    const view = currentModel?.view === 'add-form' ? 'add-form' : 'list'
    const action = resolveProjectSelectorKey(view, (event as KeyboardEvent).key)
    if (!action) return
    if ((event as KeyboardEvent).key === 'Tab') (event as KeyboardEvent).preventDefault()
    switch (action.type) {
      case 'highlight':
        highlightCallback?.(action.delta)
        break
      case 'activate':
        activateHighlighted()
        break
      case 'close':
        closeCallback?.()
        break
      case 'submit':
        addSubmitCallback?.()
        break
      case 'cancel':
        addCancelCallback?.()
        break
    }
  })

  return {
    element: root,
    apply(model: ProjectSelectorPanelModel) {
      currentModel = model
      const isList = model.view === 'list'
      listSection.style.display = isList ? '' : 'none'
      formSection.style.display = isList ? 'none' : ''
      if (isList) {
        queryInput.value = model.query
        rows.replaceChildren()
        for (const row of model.rows) {
          const rowElement = doc.createElement('div')
          rowElement.className = [
            'cubito-project-selector__row',
            row.active ? 'cubito-project-selector__row--active' : '',
            row.highlighted ? 'cubito-project-selector__row--highlighted' : ''
          ]
            .filter(Boolean)
            .join(' ')
          rowElement.textContent = `${row.displayName} — ${row.path}`
          rowElement.addEventListener('click', () => activateCallback?.(row.repoId))
          rows.appendChild(rowElement)
        }
        addRow.className = [
          'cubito-project-selector__row',
          'cubito-project-selector__row--add',
          model.addRowHighlighted ? 'cubito-project-selector__row--highlighted' : ''
        ]
          .filter(Boolean)
          .join(' ')
        return
      }
      pathInput.value = model.path
      kindSelect.value = model.kind
      setupInput.value = model.setup
      submitButton.textContent = model.submitLabel
      submitButton.disabled = !model.submitEnabled
      renderFailureText(doc, errorLine, model.errorMessage)
      errorLine.style.display = model.errorMessage === null ? 'none' : ''
    },
    applySetup(model) {
      setupSection.style.display = model === null ? 'none' : ''
      if (model === null) return
      const shared = model.sharedCommand ?? null
      const sharedText = shared === null ? '' : t('projects.setupShared', { command: shared })
      renderFailureText(
        doc,
        setupLabel,
        model.message,
        `${t('projects.setupFor', { repo: model.repoName })}${sharedText}${model.message === null ? '' : ' · '}`
      )
      setupCommandInput.value = model.command ?? ''
      setupCommandInput.placeholder =
        shared === null ? t('projects.setupNone') : t('projects.setupNoOverride')
    },
    onSetupSave(callback) {
      setupSaveCallback = callback
      return () => (setupSaveCallback = null)
    },
    onQueryChange(callback) {
      queryChangeCallback = callback
      return () => (queryChangeCallback = null)
    },
    onHighlight(callback) {
      highlightCallback = callback
      return () => (highlightCallback = null)
    },
    onActivate(callback) {
      activateCallback = callback
      return () => (activateCallback = null)
    },
    onOpenAddForm(callback) {
      openAddFormCallback = callback
      return () => (openAddFormCallback = null)
    },
    onClose(callback) {
      closeCallback = callback
      return () => (closeCallback = null)
    },
    onAddFieldChange(callback) {
      addFieldChangeCallback = callback
      return () => (addFieldChangeCallback = null)
    },
    onAddSubmit(callback) {
      addSubmitCallback = callback
      return () => (addSubmitCallback = null)
    },
    onAddCancel(callback) {
      addCancelCallback = callback
      return () => (addCancelCallback = null)
    },
    focusQuery() {
      queryInput.focus()
    },
    focusPath() {
      pathInput.focus()
    },
    dispose() {
      root.remove()
    }
  }
}
