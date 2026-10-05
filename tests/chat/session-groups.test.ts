import { expect, test } from 'bun:test'

import { flattenSessionGroups } from '../../packages/client/src/lib/chat/session-groups'

const page = (ids: string[], status = 'Exhausted') => ({
  results: ids.map((_id) => ({ _id })) as never,
  status,
})

test('groups retain manual order and deduplicate rows', () => {
  const rows = flattenSessionGroups(
    ['pinned', 'b', 'a', 'ungrouped'],
    {
      pinned: page(['p']),
      b: page(['b', 'p'], 'CanLoadMore'),
      a: page(['a']),
      ungrouped: page([]),
    },
    {},
  )
  expect(rows).toEqual([
    { kind: 'header', key: 'pinned' },
    { kind: 'session', key: 'pinned', id: 'p' },
    { kind: 'header', key: 'b' },
    { kind: 'session', key: 'b', id: 'b' },
    { kind: 'footer', key: 'b' },
    { kind: 'header', key: 'a' },
    { kind: 'session', key: 'a', id: 'a' },
    { kind: 'header', key: 'ungrouped' },
    { kind: 'footer', key: 'ungrouped' },
  ])
})

test('empty Pinned stays visible and collapsed folders retain headers', () => {
  expect(
    flattenSessionGroups(
      ['pinned', 'a'],
      { pinned: page([]), a: page(['s']) },
      { a: true },
    ),
  ).toEqual([
    { kind: 'header', key: 'pinned' },
    { kind: 'footer', key: 'pinned' },
    { kind: 'header', key: 'a' },
  ])
})

test('global search is flat even when a saved collapse key is present', () => {
  expect(
    flattenSessionGroups(
      ['search'],
      { search: page(['s'], 'CanLoadMore') },
      { search: true },
    ),
  ).toEqual([
    { kind: 'session', key: 'search', id: 's' },
    { kind: 'footer', key: 'search' },
  ])
})

test('loading and empty Pinned keep a stable header before dragging', () => {
  for (const status of ['LoadingFirstPage', 'Exhausted']) {
    expect(
      flattenSessionGroups(['pinned'], { pinned: page([], status) }, {}),
    ).toEqual([
      { kind: 'header', key: 'pinned' },
      { kind: 'footer', key: 'pinned' },
    ])
    expect(
      flattenSessionGroups(
        ['pinned'],
        { pinned: page([], status) },
        { pinned: true },
      ),
    ).toEqual([{ kind: 'header', key: 'pinned' }])
  }
})
