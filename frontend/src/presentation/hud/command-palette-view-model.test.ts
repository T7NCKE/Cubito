import { describe, expect, it } from 'vitest'
import { commandPaletteViewModel } from './command-palette-view-model'
import { commandCatalog } from '../../application/command-catalog'
import type { CommandPaletteSlice } from '../../application/command-palette-model'
import type { CommandAvailability } from '../../application/command-catalog'

const catalog = commandCatalog({ isMac: true })
const allAvailable: CommandAvailability = {
  hasSelection: true,
  isConnected: true,
  hasLitter: true
}
const noneAvailable: CommandAvailability = {
  hasSelection: false,
  isConnected: false,
  hasLitter: false
}

describe('commandPaletteViewModel', () => {
  it('returns null when closed', () => {
    expect(commandPaletteViewModel({ view: 'closed' }, catalog, allAvailable)).toBeNull()
  })

  it('lists every command with no filter, in catalog order', () => {
    const slice: CommandPaletteSlice = { view: 'open', query: '', highlightedIndex: 0 }
    const model = commandPaletteViewModel(slice, catalog, allAvailable)
    expect(model).toMatchObject({ view: 'open', query: '' })
    expect(model?.rows.map((r) => r.id)).toEqual(catalog.map((c) => c.id))
  })

  it('filters case-insensitively by label substring', () => {
    const slice: CommandPaletteSlice = { view: 'open', query: 'ver', highlightedIndex: 0 }
    const model = commandPaletteViewModel(slice, catalog, allAvailable)
    expect(model?.rows.map((r) => r.id)).toEqual(['fit-all'])
  })

  it('a query matching nothing yields an empty row list without crashing (no add-row, total===0 guard)', () => {
    const slice: CommandPaletteSlice = { view: 'open', query: 'zzz-no-match', highlightedIndex: 0 }
    const model = commandPaletteViewModel(slice, catalog, allAvailable)
    expect(model?.rows).toEqual([])
  })

  it('resolves per-row availability from the projected CommandAvailability', () => {
    const slice: CommandPaletteSlice = { view: 'open', query: '', highlightedIndex: 0 }
    const model = commandPaletteViewModel(slice, catalog, noneAvailable)
    const focus = model?.rows.find((r) => r.id === 'focus')
    const fitAll = model?.rows.find((r) => r.id === 'fit-all')
    expect(focus?.available).toBe(false)
    expect(fitAll?.available).toBe(true)
  })

  it('wraps a highlightedIndex past the end back to the first row', () => {
    const total = catalog.length
    const slice: CommandPaletteSlice = { view: 'open', query: '', highlightedIndex: total }
    const model = commandPaletteViewModel(slice, catalog, allAvailable)
    expect(model?.rows[0]!.highlighted).toBe(true)
  })

  it('wraps a negative highlightedIndex back from the end', () => {
    const slice: CommandPaletteSlice = { view: 'open', query: '', highlightedIndex: -1 }
    const model = commandPaletteViewModel(slice, catalog, allAvailable)
    expect(model?.rows[model.rows.length - 1]!.highlighted).toBe(true)
  })

  it('highlight can land on a disabled row (no per-row gating during navigation)', () => {
    const focusIndex = catalog.findIndex((c) => c.id === 'focus')
    const slice: CommandPaletteSlice = {
      view: 'open',
      query: '',
      highlightedIndex: focusIndex
    }
    const model = commandPaletteViewModel(slice, catalog, noneAvailable)
    const focus = model?.rows.find((r) => r.id === 'focus')
    expect(focus?.highlighted).toBe(true)
    expect(focus?.available).toBe(false)
  })
})
