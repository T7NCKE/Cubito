import type { SceneState } from './scene-store'
import { t } from './i18n/translate'
import { compareLitterMembers } from './compare-litter'

export type CommandId =
  | 'focus'
  | 'fit-all'
  | 'open-terminal'
  | 'open-spawn'
  | 'open-projects'
  | 'add-repo'
  | 'fan-out'
  | 'open-system'
  | 'open-diff'
  | 'open-compare'
  | 'delete-worktree'
  | 'open-file'
  | 'switch-language'

export type CommandAvailability = {
  readonly hasSelection: boolean
  readonly isConnected: boolean
  /** True while there is a litter to compare (running or restored) — open-compare's anchor, not selection. */
  readonly hasLitter: boolean
}

export type PaletteCommand = {
  readonly id: CommandId
  readonly label: string
  readonly keybindingHint: string
  readonly isAvailable: (availability: CommandAvailability) => boolean
}

/** Projects SceneState into the flags the catalog's predicates read — 'reconnecting'/'connecting'/
 *  'down' all count as not connected (commands stay disabled through connection blips). */
export const toCommandAvailability = (state: SceneState): CommandAvailability => ({
  hasSelection: state.selection.selectedId !== null,
  isConnected: state.connection.state === 'connected',
  hasLitter: compareLitterMembers(state).length > 0
})

/** Static, ordered ⌘K catalog (proposal order). Pure and deterministic given platform — the one
 *  platform-variant hint (open-projects) resolves here instead of through DOM/env lookups. */
export const commandCatalog = (platform: { isMac: boolean }): readonly PaletteCommand[] => [
  {
    id: 'focus',
    label: t('palette.focus'),
    keybindingHint: 'f',
    isAvailable: (a) => a.hasSelection
  },
  {
    id: 'fit-all',
    label: t('palette.fitAll'),
    keybindingHint: 'v',
    isAvailable: () => true
  },
  {
    id: 'open-terminal',
    label: t('palette.openTerminal'),
    keybindingHint: 't',
    isAvailable: (a) => a.hasSelection && a.isConnected
  },
  {
    id: 'open-spawn',
    label: t('palette.openSpawn'),
    keybindingHint: 's',
    isAvailable: (a) => a.isConnected
  },
  {
    id: 'open-projects',
    label: t('palette.projects'),
    keybindingHint: platform.isMac ? '⌘P' : 'Ctrl+P',
    isAvailable: () => true
  },
  {
    id: 'add-repo',
    label: t('palette.addRepo'),
    keybindingHint: '—',
    isAvailable: (a) => a.isConnected
  },
  {
    id: 'fan-out',
    label: t('palette.fanOut'),
    keybindingHint: '—',
    isAvailable: (a) => a.hasSelection && a.isConnected
  },
  {
    id: 'open-system',
    label: t('palette.openSystem'),
    keybindingHint: 'x',
    // Unlike open-terminal, no isConnected gate — the demo graph stub works offline.
    isAvailable: (a) => a.hasSelection
  },
  {
    id: 'open-diff',
    label: t('palette.openDiff'),
    keybindingHint: 'd',
    // Mirrors open-system: hasSelection only — the demo gateway's gitBranchCompare stub
    // resolves offline too, so no isConnected gate.
    isAvailable: (a) => a.hasSelection
  },
  {
    id: 'open-compare',
    label: t('palette.openCompare'),
    keybindingHint: 'c',
    // Anchor is the litter, not selection — hasSelection is irrelevant here.
    isAvailable: (a) => a.hasLitter
  },
  {
    id: 'delete-worktree',
    label: t('palette.deleteWorktree'),
    keybindingHint: '⌫',
    // The confirm panel itself explains why the primary worktree is refused.
    isAvailable: (a) => a.hasSelection && a.isConnected
  },
  {
    id: 'open-file',
    label: t('palette.openFile'),
    keybindingHint: 'o',
    isAvailable: (a) => a.hasSelection && a.isConnected
  },
  {
    id: 'switch-language',
    label: t('palette.switchLanguage'),
    keybindingHint: '—',
    isAvailable: () => true
  }
]
