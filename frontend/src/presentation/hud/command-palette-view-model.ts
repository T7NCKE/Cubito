import type { CommandPaletteSlice } from '../../application/command-palette-model'
import type {
  CommandAvailability,
  CommandId,
  PaletteCommand
} from '../../application/command-catalog'

export type CommandPaletteRow = {
  readonly id: CommandId
  readonly label: string
  readonly keybindingHint: string
  readonly available: boolean
  readonly highlighted: boolean
}

export type CommandPaletteViewModel = {
  readonly view: 'open'
  readonly query: string
  readonly rows: readonly CommandPaletteRow[]
} | null

const matchesQuery = (command: PaletteCommand, query: string): boolean => {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return (
    command.label.toLowerCase().includes(q) || (command.keywords ?? '').toLowerCase().includes(q)
  )
}

/** Wraps highlightedIndex into `[0, total)` — always yields a valid highlight, wrapping either direction. */
const wrap = (index: number, total: number): number => ((index % total) + total) % total

/**
 * Pure render model for the ⌘K palette. Filters the static catalog by query — unlike the
 * ⌘P selector there is NO trailing add-row, so `total` can legitimately be 0 on a no-match
 * query; guard it before wrap() to avoid a div-by-zero / NaN highlight index.
 */
export function commandPaletteViewModel(
  slice: CommandPaletteSlice,
  catalog: readonly PaletteCommand[],
  availability: CommandAvailability
): CommandPaletteViewModel {
  if (slice.view === 'closed') return null
  const filtered = catalog.filter((command) => matchesQuery(command, slice.query))
  const total = filtered.length
  const index = total > 0 ? wrap(slice.highlightedIndex, total) : -1
  const rows = filtered.map((command, i) => ({
    id: command.id,
    label: command.label,
    keybindingHint: command.keybindingHint,
    available: command.isAvailable(availability),
    highlighted: i === index
  }))
  return { view: 'open', query: slice.query, rows }
}
