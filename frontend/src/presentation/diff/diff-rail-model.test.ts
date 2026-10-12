import { describe, expect, it } from 'vitest'
import { diffRailFailure, diffRailViewModel } from './diff-rail-model'
import { plainFailure } from '../../application/i18n/user-facing-error'
import type { DiffFileRow } from '../../application/diff-view-model'

const file = (overrides: Partial<DiffFileRow> & Pick<DiffFileRow, 'path'>): DiffFileRow => ({
  status: 'modified',
  added: 0,
  removed: 0,
  ...overrides
})

describe('diffRailViewModel — path split', () => {
  it('splits the directory from the file name so the name can stay visible', () => {
    const [nested, bare] = diffRailViewModel(
      [file({ path: 'src/routes/auth/login.ts' }), file({ path: 'README.md' })],
      null
    )
    expect(nested).toMatchObject({ dirText: 'src/routes/auth/', baseText: 'login.ts' })
    expect(bare).toMatchObject({ dirText: '', baseText: 'README.md' })
  })
})

describe('diffRailViewModel', () => {
  it('returns [] for an empty file list', () => {
    expect(diffRailViewModel([], null)).toEqual([])
  })

  it('maps path/status through and formats added/removed counts', () => {
    const rows = diffRailViewModel(
      [file({ path: 'a.ts', status: 'modified', added: 3, removed: 1 })],
      null
    )
    expect(rows).toEqual([
      {
        path: 'a.ts',
        dirText: '',
        baseText: 'a.ts',
        status: 'modified',
        addedText: '+3',
        removedText: '−1',
        cssClass: 'diff-rail__row diff-rail__row--modified',
        selected: false
      }
    ])
  })

  it('flags the row matching selectedPath as selected and adds the modifier class', () => {
    const rows = diffRailViewModel([file({ path: 'a.ts' }), file({ path: 'b.ts' })], 'b.ts')
    expect(rows[0]!.selected).toBe(false)
    expect(rows[1]!.selected).toBe(true)
    expect(rows[1]!.cssClass).toBe(
      'diff-rail__row diff-rail__row--modified diff-rail__row--selected'
    )
    expect(rows[0]!.cssClass).toBe('diff-rail__row diff-rail__row--modified')
  })

  it('uses the real minus glyph for removedText, not a hyphen', () => {
    const rows = diffRailViewModel([file({ path: 'a.ts', removed: 5 })], null)
    expect(rows[0]!.removedText).toBe('−5')
    expect(rows[0]!.removedText).not.toBe('-5')
  })

  it.each(['added', 'deleted', 'modified', 'renamed'])(
    'encodes status "%s" into cssClass',
    (status) => {
      const rows = diffRailViewModel([file({ path: 'a.ts', status })], null)
      expect(rows[0]!.cssClass).toContain(`diff-rail__row--${status}`)
    }
  )

  it('shows the old path hint for a renamed row', () => {
    const rows = diffRailViewModel(
      [file({ path: 'b.ts', status: 'renamed', oldPath: 'a.ts' })],
      null
    )
    expect(rows[0]!.oldPathText).toBe('a.ts →')
  })

  it('omits the old path hint when the row has no oldPath', () => {
    const rows = diffRailViewModel([file({ path: 'a.ts' })], null)
    expect(rows[0]).not.toHaveProperty('oldPathText')
  })

  it('tags a working-tree modified row "sin commitear"', () => {
    const rows = diffRailViewModel(
      [file({ path: 'a.ts', status: 'modified', origin: 'working' })],
      null
    )
    expect(rows[0]!.originText).toBe('sin commitear')
  })

  it('tags an untracked row "naciendo"', () => {
    const rows = diffRailViewModel(
      [file({ path: 'a.ts', status: 'untracked', origin: 'working' })],
      null
    )
    expect(rows[0]!.originText).toBe('naciendo')
  })

  it('leaves a branch-only row without an origin badge', () => {
    const rows = diffRailViewModel(
      [file({ path: 'a.ts', status: 'modified', origin: 'branch' })],
      null
    )
    expect(rows[0]).not.toHaveProperty('originText')
  })

  it('adds diff-rail__row--wt to rows with a working-tree component, not to branch-only rows', () => {
    const rows = diffRailViewModel(
      [
        file({ path: 'a.ts', status: 'modified', origin: 'working' }),
        file({ path: 'b.ts', status: 'modified', origin: 'both' }),
        file({ path: 'c.ts', status: 'modified', origin: 'branch' })
      ],
      null
    )
    expect(rows[0]!.cssClass).toContain('diff-rail__row--wt')
    expect(rows[1]!.cssClass).toContain('diff-rail__row--wt')
    expect(rows[2]!.cssClass).not.toContain('diff-rail__row--wt')
  })

  describe('stage toggles', () => {
    const wt = (path: string) => file({ path, origin: 'working' })

    it('adds a stage descriptor only to rows that have a stage state', () => {
      const rows = diffRailViewModel(
        [wt('a.ts'), wt('b.ts'), file({ path: 'c.ts', origin: 'branch' })],
        null,
        new Map([
          ['a.ts', 'staged'],
          ['b.ts', 'unstaged']
        ])
      )
      expect(rows[0]!.stage).toEqual({ state: 'staged', glyph: '●', label: 'quitar del stage' })
      expect(rows[1]!.stage).toEqual({ state: 'unstaged', glyph: '○', label: 'stagear' })
      expect(rows[2]!.stage).toBeUndefined()
    })

    it('shows a partial stage as half-filled and stages the rest on toggle', () => {
      const [row] = diffRailViewModel([wt('a.ts')], null, new Map([['a.ts', 'partial']]))
      expect(row!.stage).toEqual({ state: 'partial', glyph: '◐', label: 'stagear el resto' })
    })

    it('leaves rows untouched when no stage states are given', () => {
      expect(diffRailViewModel([wt('a.ts')], null)[0]!.stage).toBeUndefined()
    })
  })
})

describe('diffRailFailure', () => {
  it('is null unless the rail errored', () => {
    expect(diffRailFailure('ready', undefined)).toBeNull()
    expect(diffRailFailure('empty', plainFailure('x'))).toBeNull()
  })

  it('surfaces the stored failure when the rail errored', () => {
    const failure = { lead: 'no se pudo leer', detail: 'boom' }
    expect(diffRailFailure('error', failure)).toBe(failure)
  })

  it('falls back to the localized unknown failure when none was stored', () => {
    expect(diffRailFailure('error', undefined)).toEqual({ lead: 'algo salió mal', detail: null })
  })
})
