import { expect, test } from 'bun:test'

import { flattenSessionGroups } from '../../packages/client/src/lib/chat/session-groups'

const page = (ids: string[], status = 'Exhausted') => ({
  results: ids.map((_id) => ({ _id })) as never,
  status,
})

test('groups retain manual order, omit empty special groups, and deduplicate rows', () => {
  const rows = flattenSessionGroups(
    ['pinned', 'b', 'a', 'ungrouped', 'shared'],
    {
      pinned: page(['p']),
      b: page(['b', 'p'], 'CanLoadMore'),
      a: page(['a']),
      ungrouped: page([]),
      shared: page([]),
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

test('collapsed folders retain headers; dragging exposes the empty pin target', () => {
  expect(
    flattenSessionGroups(
      ['pinned', 'a'],
      { pinned: page([]), a: page(['s']) },
      { a: true },
      true,
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
