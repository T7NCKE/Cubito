import { plainFailure } from './i18n/user-facing-error'
import { describe, expect, it } from 'vitest'
import {
  emptyCompareViewSlice,
  reduceCompareView,
  sceneSelectedId,
  stepCompareFocus
} from './compare-view-model'
import { emptyCompareChildLoad, reduceCompareChildLoad } from './compare-child-load'
import type { DiffFileRow } from './diff-view-model'

const fileRow = (overrides: Partial<DiffFileRow> = {}): DiffFileRow => ({
  path: 'src/auth.ts',
  status: 'modified',
  added: 3,
  removed: 1,
  ...overrides
})

const MEMBERS = ['w-child-1', 'w-child-2'] as const

const openSlice = (members: readonly string[] = MEMBERS) =>
  reduceCompareView(emptyCompareViewSlice(), { type: 'open', members })

describe('emptyCompareViewSlice', () => {
  it('starts closed', () => {
    expect(emptyCompareViewSlice()).toEqual({ view: 'closed' })
  })
})

describe('reduceCompareView — open/close', () => {
  it('open anchors to every member and auto-focuses the first one (design D4)', () => {
    const slice = openSlice()
    expect(slice).toEqual({
      view: 'open',
      members: MEMBERS,
      focusedChildId: 'w-child-1',
      winnerId: null,
      merge: { phase: 'idle' },
      childLoads: {
        'w-child-1': emptyCompareChildLoad(),
        'w-child-2': emptyCompareChildLoad()
      }
    })
  })

  it('opening an empty litter leaves the focus null', () => {
    const slice = openSlice([])
    expect(slice).toMatchObject({ view: 'open', members: [], focusedChildId: null })
  })

  it('close returns to closed from any open state', () => {
    expect(reduceCompareView(openSlice(), { type: 'close' })).toEqual({ view: 'closed' })
  })

  it('re-opening replaces the member set, resets every child load and refocuses the new first member', () => {
    const slice = reduceCompareView(openSlice(), { type: 'open', members: ['w-child-3'] })
    expect(slice).toEqual({
      view: 'open',
      members: ['w-child-3'],
      focusedChildId: 'w-child-3',
      winnerId: null,
      merge: { phase: 'idle' },
      childLoads: { 'w-child-3': emptyCompareChildLoad() }
    })
  })
})

describe('stepCompareFocus', () => {
  const members = ['w-1', 'w-2', 'w-3']

  it('walks forward and backward in rail order', () => {
    expect(stepCompareFocus(members, 'w-1', 1)).toBe('w-2')
    expect(stepCompareFocus(members, 'w-2', 1)).toBe('w-3')
    expect(stepCompareFocus(members, 'w-3', -1)).toBe('w-2')
    expect(stepCompareFocus(members, 'w-2', -1)).toBe('w-1')
  })

  it('wraps at both ends', () => {
    expect(stepCompareFocus(members, 'w-3', 1)).toBe('w-1')
    expect(stepCompareFocus(members, 'w-1', -1)).toBe('w-3')
  })

  it('enters at the first member going forward and the last member going backward from null', () => {
    expect(stepCompareFocus(members, null, 1)).toBe('w-1')
    expect(stepCompareFocus(members, null, -1)).toBe('w-3')
  })

  it('returns null for empty members', () => {
    expect(stepCompareFocus([], null, 1)).toBeNull()
    expect(stepCompareFocus([], 'w-1', -1)).toBeNull()
  })

  it('returns the first member when the focus is not in members (a member removed mid-camada)', () => {
    expect(stepCompareFocus(members, 'w-removed', 1)).toBe('w-1')
    expect(stepCompareFocus(members, 'w-removed', -1)).toBe('w-1')
  })
})

describe('sceneSelectedId', () => {
  it('projects the compare focus while open and the graph selection while closed', () => {
    const open = openSlice()
    expect(sceneSelectedId(open, 'graph-selected')).toBe('w-child-1')
    expect(sceneSelectedId(emptyCompareViewSlice(), 'graph-selected')).toBe('graph-selected')
  })

  it('is null while compare is open with no focus', () => {
    const openEmpty = openSlice([])
    expect(sceneSelectedId(openEmpty, 'graph-selected')).toBeNull()
  })
})

describe('reduceCompareView — members-added', () => {
  it('appends new members with an empty load and keeps focus, winner and existing loads', () => {
    const loaded = reduceCompareView(
      reduceCompareView(openSlice(), { type: 'focus-child', childId: 'w-child-2' }),
      { type: 'set-winner', winnerId: 'w-child-2' }
    )
    const slice = reduceCompareView(loaded, { type: 'members-added', members: ['w-child-3'] })
    expect(slice).toMatchObject({
      members: ['w-child-1', 'w-child-2', 'w-child-3'],
      focusedChildId: 'w-child-2',
      winnerId: 'w-child-2'
    })
    expect(slice.view === 'open' && slice.childLoads['w-child-3']).toEqual(emptyCompareChildLoad())
  })

  it('ignores members already present and is a no-op when closed', () => {
    const open = openSlice()
    expect(reduceCompareView(open, { type: 'members-added', members: ['w-child-1'] })).toBe(open)
    const closed = emptyCompareViewSlice()
    expect(reduceCompareView(closed, { type: 'members-added', members: ['x'] })).toBe(closed)
  })
})

describe('reduceCompareView — focus-child', () => {
  it('sets focusedChildId when open', () => {
    const slice = reduceCompareView(openSlice(), { type: 'focus-child', childId: 'w-child-1' })
    expect(slice).toMatchObject({ focusedChildId: 'w-child-1' })
  })

  it('is a no-op when closed', () => {
    const closed = emptyCompareViewSlice()
    expect(reduceCompareView(closed, { type: 'focus-child', childId: 'w-child-1' })).toBe(closed)
  })
})

describe('reduceCompareView — set-winner', () => {
  it('records the winner (record-only, no merge)', () => {
    const slice = reduceCompareView(openSlice(), { type: 'set-winner', winnerId: 'w-child-2' })
    expect(slice).toMatchObject({ winnerId: 'w-child-2' })
  })

  it('clears the winner with null', () => {
    const withWinner = reduceCompareView(openSlice(), { type: 'set-winner', winnerId: 'w-child-1' })
    const cleared = reduceCompareView(withWinner, { type: 'set-winner', winnerId: null })
    expect(cleared).toMatchObject({ winnerId: null })
  })

  it('is a no-op when closed', () => {
    const closed = emptyCompareViewSlice()
    expect(reduceCompareView(closed, { type: 'set-winner', winnerId: 'w-child-1' })).toBe(closed)
  })
})

describe('reduceCompareView — merge (Change E)', () => {
  it('open initializes merge to idle', () => {
    expect(openSlice()).toMatchObject({ merge: { phase: 'idle' } })
  })

  it('merge-start sets phase to running', () => {
    const slice = reduceCompareView(openSlice(), { type: 'merge-start' })
    expect(slice).toMatchObject({ merge: { phase: 'running' } })
  })

  it('merge-clean sets phase to clean with the commitOid', () => {
    const running = reduceCompareView(openSlice(), { type: 'merge-start' })
    const slice = reduceCompareView(running, { type: 'merge-clean', commitOid: 'abc123' })
    expect(slice).toMatchObject({ merge: { phase: 'clean', commitOid: 'abc123' } })
  })

  it('merge-clean carries an optional workingTree sync result through', () => {
    const running = reduceCompareView(openSlice(), { type: 'merge-start' })
    const slice = reduceCompareView(running, {
      type: 'merge-clean',
      commitOid: 'abc123',
      workingTree: { status: 'skipped', reason: 'dirty' }
    })
    expect(slice).toMatchObject({
      merge: {
        phase: 'clean',
        commitOid: 'abc123',
        workingTree: { status: 'skipped', reason: 'dirty' }
      }
    })
  })

  it('merge-clean carries an optional dependencySetup outcome through', () => {
    const running = reduceCompareView(openSlice(), { type: 'merge-start' })
    const slice = reduceCompareView(running, {
      type: 'merge-clean',
      commitOid: 'abc123',
      dependencySetup: { status: 'started' }
    })
    expect(slice).toMatchObject({
      merge: { phase: 'clean', dependencySetup: { status: 'started' } }
    })
  })

  it('merge-conflict sets phase to conflict with the file list', () => {
    const running = reduceCompareView(openSlice(), { type: 'merge-start' })
    const slice = reduceCompareView(running, {
      type: 'merge-conflict',
      files: ['src/a.ts', 'src/b.ts']
    })
    expect(slice).toMatchObject({ merge: { phase: 'conflict', files: ['src/a.ts', 'src/b.ts'] } })
  })

  it('merge-error sets phase to error with the message', () => {
    const running = reduceCompareView(openSlice(), { type: 'merge-start' })
    const slice = reduceCompareView(running, {
      type: 'merge-error',
      message: plainFailure('host unavailable')
    })
    expect(slice).toMatchObject({
      merge: { phase: 'error', message: plainFailure('host unavailable') }
    })
  })

  it('merge-reset returns to idle from any phase', () => {
    const clean = reduceCompareView(reduceCompareView(openSlice(), { type: 'merge-start' }), {
      type: 'merge-clean',
      commitOid: 'x'
    })
    expect(reduceCompareView(clean, { type: 'merge-reset' })).toMatchObject({
      merge: { phase: 'idle' }
    })
  })

  it('every merge action is a no-op when closed', () => {
    const closed = emptyCompareViewSlice()
    expect(reduceCompareView(closed, { type: 'merge-start' })).toBe(closed)
    expect(reduceCompareView(closed, { type: 'merge-clean', commitOid: 'x' })).toBe(closed)
    expect(reduceCompareView(closed, { type: 'merge-conflict', files: [] })).toBe(closed)
    expect(reduceCompareView(closed, { type: 'merge-error', message: plainFailure('x') })).toBe(
      closed
    )
    expect(reduceCompareView(closed, { type: 'merge-reset' })).toBe(closed)
  })

  it('re-opening resets merge back to idle', () => {
    const clean = reduceCompareView(reduceCompareView(openSlice(), { type: 'merge-start' }), {
      type: 'merge-clean',
      commitOid: 'x'
    })
    const reopened = reduceCompareView(clean, { type: 'open', members: MEMBERS })
    expect(reopened).toMatchObject({ merge: { phase: 'idle' } })
  })
})

describe('reduceCompareView — per-child load actions route by childId', () => {
  it('child-rail-loaded updates only the targeted child, leaving siblings untouched', () => {
    const before = openSlice()
    const compare = { headOid: 'abc', mergeBase: 'def' }
    const files = [fileRow()]
    const slice = reduceCompareView(before, {
      type: 'child-rail-loaded',
      childId: 'w-child-1',
      compare,
      files
    })
    expect(slice).toMatchObject({ view: 'open' })
    if (slice.view !== 'open') throw new Error('unreachable')
    expect(slice.childLoads['w-child-1']).toMatchObject({ status: 'ready', compare, files })
    expect(slice.childLoads['w-child-2']).toBe(
      (before as Extract<typeof before, { view: 'open' }>).childLoads['w-child-2']
    )
  })

  it('child-rail-loaded drops a stale errorMessage on the reloaded child', () => {
    const errored = {
      ...emptyCompareChildLoad(),
      status: 'error' as const,
      errorMessage: plainFailure('boom')
    }
    const next = reduceCompareChildLoad(errored, {
      type: 'child-rail-loaded',
      childId: 'c1',
      compare: { headOid: 'h', mergeBase: 'm' },
      files: []
    })
    expect(next.status).toBe('empty')
    expect(next).not.toHaveProperty('errorMessage')
  })

  it('child-rail-error is isolated per child (continue-on-error)', () => {
    const slice = reduceCompareView(openSlice(), {
      type: 'child-rail-error',
      childId: 'w-child-2',
      message: plainFailure('base inválida')
    })
    if (slice.view !== 'open') throw new Error('unreachable')
    expect(slice.childLoads['w-child-2']).toMatchObject({
      status: 'error',
      errorMessage: plainFailure('base inválida')
    })
    expect(slice.childLoads['w-child-1']).toEqual(emptyCompareChildLoad())
  })

  it('select-file, child-panel-loaded and child-panel-error are scoped to the given childId', () => {
    const withFiles = reduceCompareView(openSlice(), {
      type: 'child-rail-loaded',
      childId: 'w-child-1',
      compare: { headOid: 'a', mergeBase: 'b' },
      files: [fileRow()]
    })
    const selected = reduceCompareView(withFiles, {
      type: 'select-file',
      childId: 'w-child-1',
      path: 'src/auth.ts'
    })
    if (selected.view !== 'open') throw new Error('unreachable')
    expect(selected.childLoads['w-child-1']).toMatchObject({
      selectedPath: 'src/auth.ts',
      panel: { kind: 'loading' }
    })

    const loaded = reduceCompareView(selected, {
      type: 'child-panel-loaded',
      childId: 'w-child-1',
      path: 'src/auth.ts',
      content: { kind: 'binary' }
    })
    if (loaded.view !== 'open') throw new Error('unreachable')
    expect(loaded.childLoads['w-child-1']?.panel).toEqual({ kind: 'binary' })

    const errored = reduceCompareView(loaded, {
      type: 'child-panel-error',
      childId: 'w-child-1',
      path: 'src/other.ts'
    })
    // stale path — no-op, panel keeps the loaded content
    if (errored.view !== 'open') throw new Error('unreachable')
    expect(errored.childLoads['w-child-1']).toBe(loaded.childLoads['w-child-1'])
  })

  it('is a no-op for a childId not in the member set', () => {
    const before = openSlice()
    const slice = reduceCompareView(before, {
      type: 'child-rail-error',
      childId: 'w-not-a-member',
      message: plainFailure('x')
    })
    expect(slice).toBe(before)
  })

  it('every per-child action is a no-op when closed', () => {
    const closed = emptyCompareViewSlice()
    expect(
      reduceCompareView(closed, { type: 'select-file', childId: 'w-child-1', path: 'x' })
    ).toBe(closed)
    expect(
      reduceCompareView(closed, {
        type: 'child-rail-loaded',
        childId: 'w-child-1',
        compare: { headOid: 'a', mergeBase: 'b' },
        files: []
      })
    ).toBe(closed)
  })
})

describe('reduceCompareView — atomic sync outcomes', () => {
  it('merge-blocked records the reason and paths', () => {
    const running = reduceCompareView(openSlice(), { type: 'merge-start' })
    const slice = reduceCompareView(running, {
      type: 'merge-blocked',
      reason: 'dirty-parent',
      paths: ['base.txt']
    })
    expect(slice).toMatchObject({
      merge: { phase: 'blocked', reason: 'dirty-parent', paths: ['base.txt'] }
    })
  })

  it('merge-already-merged records the parent tip', () => {
    const slice = reduceCompareView(openSlice(), { type: 'merge-already-merged', commitOid: 'abc' })
    expect(slice).toMatchObject({ merge: { phase: 'already-merged', commitOid: 'abc' } })
  })

  it('picking a different winner resets the merge state', () => {
    let slice = reduceCompareView(openSlice(), { type: 'set-winner', winnerId: 'w-child-1' })
    slice = reduceCompareView(slice, { type: 'merge-already-merged', commitOid: 'abc' })
    expect(reduceCompareView(slice, { type: 'set-winner', winnerId: 'w-child-1' })).toMatchObject({
      merge: { phase: 'already-merged' }
    })
    expect(reduceCompareView(slice, { type: 'set-winner', winnerId: 'w-child-2' })).toMatchObject({
      merge: { phase: 'idle' }
    })
  })
})
