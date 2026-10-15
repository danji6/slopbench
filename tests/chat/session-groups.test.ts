import { expect, test } from 'bun:test'

import {
  flattenSessionGroups,
  flattenSessionTree,
  nestSessionRows,
} from '../../packages/client/src/lib/chat/session-groups'

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
    { kind: 'separator', key: 'ungrouped' },
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
  expect(flattenSessionGroups(['search'], { search: page([]) }, {})).toEqual([
    { kind: 'footer', key: 'search' },
  ])
})

test('loading and empty Pinned keep a stable header without a placeholder', () => {
  for (const status of ['LoadingFirstPage', 'Exhausted']) {
    expect(
      flattenSessionGroups(['pinned'], { pinned: page([], status) }, {}),
    ).toEqual([{ kind: 'header', key: 'pinned' }])
    expect(
      flattenSessionGroups(
        ['pinned'],
        { pinned: page([], status) },
        { pinned: true },
      ),
    ).toEqual([{ kind: 'header', key: 'pinned' }])
  }
})

test('loading groups omit placeholders and retain the load-more footer during pagination', () => {
  for (const key of ['ungrouped', 'search', 'a']) {
    for (const pages of [{}, { [key]: page([], 'LoadingFirstPage') }]) {
      const rows = flattenSessionGroups([key], pages, {})
      expect(rows.some((row) => row.kind === 'footer')).toBe(false)
    }
    const rows = flattenSessionGroups(
      [key],
      { [key]: page(['existing'], 'LoadingMore') },
      {},
    )
    expect(rows.slice(-2)).toEqual([
      { kind: 'session', key, id: 'existing' },
      { kind: 'footer', key },
    ])
  }
})

test('nested display branches preserve independent pins and collapsed drop boundaries', () => {
  const rows = flattenSessionTree(
    [
      { _id: 'a', name: 'Parent', position: 0 },
      { _id: 'b', name: 'Child', parentId: 'a', position: 0 },
      {
        _id: 'p',
        name: 'Pinned child',
        parentId: 'a',
        pinned: true,
        position: 1,
      },
    ],
    { pinned: page([]), a: page(['s']), b: page(['c']), p: page(['p']) },
    {},
  )
  const tree = nestSessionRows(rows)
  const pinned = tree[0]!
  const parent = tree[1]!
  expect(pinned.row.key).toBe('pinned')
  expect(pinned.children.map(({ row }) => row.key)).toEqual(['p'])
  expect(parent.row.key).toBe('a')
  expect(parent.children.map(({ row }) => row.key)).toEqual(['b', 'a'])
  expect(parent.endingFolderIds).toEqual(['a'])
  expect(parent.children[0]!.endingFolderIds).toEqual(['b'])
  expect(tree[2]!.row.kind).toBe('separator')
})
