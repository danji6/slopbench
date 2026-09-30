import { expect, test } from 'bun:test'

import {
  createSessionDrop,
  projectSessionDrops,
  sessionDropConfirmed,
} from '../../packages/client/src/lib/chat/session-drops'
import type { SessionListItem } from '../../packages/client/src/lib/chat/types'

const item = (id: string, time = 10): SessionListItem => ({
  _id: id as SessionListItem['_id'],
  _creationTime: time,
  owned: true,
  participants: [],
})
const page = (results: SessionListItem[], status = 'Exhausted') => ({
  results,
  status,
  loadMore: () => {},
})
const folder = { _id: 'folder', name: 'Work', icon: 'folder' }

test('a drop immediately moves exactly one row in activity order and keeps pagination', () => {
  const original = item('moving')
  const drop = createSessionDrop(original, folder._id, folder)!
  const pages = {
    ungrouped: page([original]),
    folder: page([item('newer', 20), item('older', 1)], 'CanLoadMore'),
  }
  const projected = projectSessionDrops(pages, [drop])
  expect(projected.ungrouped!.results).toEqual([])
  expect(projected.folder!.results.map((row) => String(row._id))).toEqual([
    'newer',
    'moving',
    'older',
  ])
  expect(projected.folder!.results[1]).toMatchObject({
    folderId: 'folder',
    folderName: 'Work',
  })
  expect(projected.folder!.loadMore).toBe(pages.folder.loadMore)
  expect(projected.folder!.status).toBe('CanLoadMore')
  expect(pages.ungrouped.results).toEqual([original])
  // Removing a failed optimistic operation restores untouched server data.
  expect(projectSessionDrops(pages, [])).toBe(pages)
})

test('action completion cannot snap back while either group query is stale', () => {
  const original = item('moving')
  const drop = createSessionDrop(original, folder._id, folder)!
  const committed = { ...drop, settled: true }
  const old = { ungrouped: page([original]), folder: page([]) }
  const sourceFirst = { ...old, ungrouped: page([]) }
  const targetFirst = { ...old, folder: page([drop.item]) }
  const both = { ungrouped: page([]), folder: page([drop.item]) }
  expect(sessionDropConfirmed(drop, both)).toBe(false)
  for (const pages of [old, sourceFirst, targetFirst]) {
    expect(sessionDropConfirmed(committed, pages)).toBe(false)
    const projected = projectSessionDrops(pages, [committed])
    expect(projected.ungrouped!.results).toEqual([])
    expect(projected.folder!.results).toHaveLength(1)
  }
  expect(sessionDropConfirmed(committed, both)).toBe(true)
})

test('a committed older row can reconcile beyond the loaded destination page', () => {
  const drop = {
    ...createSessionDrop(item('moving'), folder._id, folder)!,
    settled: true,
  }
  const pages = {
    ungrouped: page([]),
    folder: page([item('newer', 20)], 'CanLoadMore'),
  }
  expect(sessionDropConfirmed(drop, pages)).toBe(true)
  expect(
    sessionDropConfirmed(drop, {
      ...pages,
      folder: page([item('older', 1)], 'CanLoadMore'),
    }),
  ).toBe(false)
})

test('pins preserve the folder; dropping a pin into Ungrouped clears both', () => {
  const original = { ...item('moving'), folderId: 'folder', folderName: 'Work' }
  const pin = createSessionDrop(original, 'pinned')!
  expect(pin.item).toMatchObject({ pinned: true, folderId: 'folder' })
  const ungroup = createSessionDrop(pin.item, 'ungrouped')!
  expect(ungroup.source).toBe('pinned')
  expect(ungroup.item.folderId).toBeUndefined()
  expect(ungroup.item.pinned).toBeUndefined()
})

test('invalid destinations and shared folder moves are ignored', () => {
  expect(createSessionDrop(item('moving'), 'ungrouped')).toBeNull()
  expect(createSessionDrop(item('moving'), 'missing')).toBeNull()
  const shared = { ...item('shared'), owned: false }
  expect(createSessionDrop(shared, folder._id, folder)).toBeNull()
  expect(createSessionDrop(shared, 'pinned')?.item.pinned).toBe(true)
})

test('live activity and search results remain current during independent moves', () => {
  const first = createSessionDrop(item('first'), folder._id, folder)!
  const second = createSessionDrop(item('second'), 'pinned')!
  const latest = { ...item('first', 50), title: 'Updated' }
  const pages = {
    ungrouped: page([latest, item('second')]),
    folder: page([]),
    pinned: page([]),
    search: page([latest]),
  }
  const projected = projectSessionDrops(pages, [first, second])
  expect(projected.folder!.results[0]).toMatchObject({
    title: 'Updated',
    _creationTime: 50,
    folderId: 'folder',
  })
  expect(String(projected.pinned!.results[0]?._id)).toBe('second')
  expect(projected.search!.results).toHaveLength(1)
  expect(projected.search!.results[0]?.folderId).toBe('folder')
})
