import type { SceneStore, SceneState } from '../../application/scene-store'
import type { CommandId } from '../../application/command-catalog'
import { commandCatalog, toCommandAvailability } from '../../application/command-catalog'
import type { CommandPaletteSlice } from '../../application/command-palette-model'
import { commandPaletteViewModel } from './command-palette-view-model'
import type { CommandPaletteHandle } from './command-palette-element'
import type {
  FileWorkspacePort,
  TerminalCommandPort,
  WorktreeDeletePort
} from '../input/keyboard-controller'
import type { CameraHeightController } from '../input/camera-height-controller'
import { compareLitterMembers } from '../../application/compare-litter'
import type { Language } from '../../application/i18n/language'
import { activeLanguage } from '../../application/i18n/translate'

export type CommandPaletteControllerDeps = {
  store: SceneStore
  heights: Pick<CameraHeightController, 'goTo'>
  terminal: Pick<TerminalCommandPort, 'focusActivePanel'>
  worktreeDelete: Pick<WorktreeDeletePort, 'request'>
  fileWorkspace: Pick<FileWorkspacePort, 'openPicker'>
  createElement: () => CommandPaletteHandle
  hud: { appendChild(element: unknown): void }
  platform: { isMac: boolean }
  language: { switchTo(language: Language): void }
}

export type CommandPaletteController = {
  sync(palette: CommandPaletteSlice, state: SceneState): void
  dispose(): void
}

/**
 * Owns the ⌘K palette's lifecycle (design Area 4), mirroring project-selector-controller: mounts
 * a single HUD element while `palette.view` is 'open'. No gateway — every dep exists eagerly at
 * startup, so this is built unconditionally rather than lazily on first connect.
 */
export function createCommandPaletteController(
  deps: CommandPaletteControllerDeps
): CommandPaletteController {
  const { store, heights, terminal, worktreeDelete, fileWorkspace } = deps
  const catalog = commandCatalog(deps.platform)
  let element: CommandPaletteHandle | null = null

  const run: Record<CommandId, () => void> = {
    focus: () => {
      heights.goTo('foco')
    },
    'fit-all': () => {
      heights.goTo('general')
    },
    'open-terminal': () => {
      const selectedId = store.get().selection.selectedId
      if (selectedId === null) return
      const activePanel = store.get().terminals.activePanel
      if (activePanel?.nodeId === selectedId) {
        store.dispatchTerminal({ type: 'set-focused', focused: true })
      } else {
        store.dispatchTerminal({ type: 'open-terminal-for-node', nodeId: selectedId })
      }
      terminal.focusActivePanel()
    },
    'open-spawn': () => {
      const selectedId = store.get().selection.selectedId
      store.dispatchSpawn(
        selectedId !== null
          ? { type: 'open-for-node', nodeId: selectedId }
          : { type: 'open-rootless' }
      )
    },
    'open-projects': () => {
      store.dispatchProjectSelector({ type: 'open' })
    },
    'add-repo': () => {
      store.dispatchProjectSelector({ type: 'open' })
      store.dispatchProjectSelector({ type: 'open-add-form' })
    },
    'fan-out': () => {
      const selectedId = store.get().selection.selectedId
      if (selectedId === null) return
      store.dispatchFanOut({ type: 'open-for-node', nodeId: selectedId })
    },
    'open-system': () => {
      const selectedId = store.get().selection.selectedId
      if (selectedId === null) return
      store.dispatchSystemView({ type: 'open', nodeId: selectedId })
    },
    'open-diff': () => {
      const selectedId = store.get().selection.selectedId
      if (selectedId === null) return
      // baseRef placeholder — bind-diff-view's loader.start() resolves the real base ref and
      // re-dispatches 'open' synchronously right after, same as the keyboard controller's 'd'.
      store.dispatchDiffView({ type: 'open', nodeId: selectedId, baseRef: '' })
    },
    'open-compare': () => {
      // Anchors on the litter, not selection — same rule as the keyboard controller's 'c'.
      const litter = compareLitterMembers(store.get())
      if (litter.length === 0) return
      store.dispatchCompareView({ type: 'open', members: litter })
    },
    'delete-worktree': () => {
      const selectedId = store.get().selection.selectedId
      if (selectedId !== null) worktreeDelete.request(selectedId)
    },
    'open-file': () => {
      const selectedId = store.get().selection.selectedId
      if (selectedId !== null) fileWorkspace.openPicker(selectedId)
    },
    'switch-language': () => {
      deps.language.switchTo(activeLanguage() === 'en' ? 'es' : 'en')
    }
  }

  /** Uniform close-then-run: closing first subsumes "modal-opening commands close the palette
   *  first" and gives execute-and-close for every command. Guard mirrors the element's own
   *  disabled-row guard (belt-and-suspenders). */
  const activate = (id: CommandId): void => {
    const command = catalog.find((c) => c.id === id)
    if (!command || !command.isAvailable(toCommandAvailability(store.get()))) return
    store.dispatchCommandPalette({ type: 'close' })
    run[id]()
  }

  const mount = (): CommandPaletteHandle => {
    if (!element) {
      const created = deps.createElement()
      created.onQueryChange((query) => store.dispatchCommandPalette({ type: 'set-query', query }))
      created.onHighlight((delta) =>
        store.dispatchCommandPalette({ type: 'move-highlight', delta })
      )
      created.onActivate((id) => activate(id))
      created.onClose(() => store.dispatchCommandPalette({ type: 'close' }))
      deps.hud.appendChild(created.element)
      element = created
      created.focusQuery()
    }
    return element
  }

  const unmount = (): void => {
    if (!element) return
    element.dispose()
    element = null
  }

  return {
    sync(palette, state) {
      if (palette.view === 'closed') {
        unmount()
        return
      }
      const mounted = mount()
      mounted.apply(commandPaletteViewModel(palette, catalog, toCommandAvailability(state)))
    },
    dispose() {
      unmount()
    }
  }
}
