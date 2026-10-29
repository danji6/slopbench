import { get, page } from '@sb/convex/model/session/folderPages'
import { expect, test } from 'bun:test'
import { type Row, makeCtx } from '~/tests/setup/query-rows'

function fixture() {
  const folders: Row[] = Array.from({ length: 35 }, (_, index) => ({
    _id: `folder-${index}`,
    ownerId: 'user_1',
    name: `Folder ${index}`,
    position: index,
    sources: [],
    revision: 0,
  }))
  folders.push(
    {
      _id: 'child',
      ownerId: 'user_1',
      name: 'Child',
      parentId: 'folder-0',
      position: 0,
      sources: [],
      revision: 0,
    },
    {
      _id: 'pin',
      ownerId: 'user_1',
      name: 'Pinned child',
      parentId: 'folder-0',
      pinned: true,
      pinnedAt: 1,
      position: 1,
      sources: [],
      revision: 0,
    },
    {
      _id: 'foreign',
      ownerId: 'user_2',
      name: 'Secret',
      position: 0,
      sources: [],
      revision: 0,
    },
  )
  const queries: string[] = []
  const ctx = makeCtx({ sessionFolders: folders }, queries)
  return { ctx, queries, folders }
}

test('root folder pages stay bounded and continue without gaps or descendant leakage', async () => {
  const { ctx, queries } = fixture()
  const first = await page(ctx, {
    groupKey: 'ungrouped',
    paginationOpts: { numItems: 10, cursor: null },
  })
  expect(first.page.map((folder) => folder._id)).toEqual(
    Array.from({ length: 10 }, (_, index) => `folder-${index}`) as never,
  )
  const second = await page(ctx, {
    groupKey: 'ungrouped',
    paginationOpts: { numItems: 20, cursor: first.continueCursor },
  })
  const last = await page(ctx, {
    groupKey: 'ungrouped',
    paginationOpts: { numItems: 20, cursor: second.continueCursor },
  })
  expect(second.page).toHaveLength(20)
  expect(last.page).toHaveLength(5)
  expect(last.isDone).toBe(true)
  expect(
    new Set(
      [...first.page, ...second.page, ...last.page].map((folder) => folder._id),
    ).size,
  ).toBe(35)
  expect(
    queries.every((query) => query.endsWith('by_owner_parent_pinned_position')),
  ).toBe(true)
})

test('child and pinned pages resolve ancestry independently of loaded root pages', async () => {
  const { ctx } = fixture()
  const children = await page(ctx, {
    groupKey: 'folder-0',
    paginationOpts: { numItems: 5, cursor: null },
  })
  expect(children.page).toMatchObject([
    { _id: 'child', folderPath: 'Folder 0 / Child', ancestorIds: ['folder-0'] },
  ])
  const pinned = await page(ctx, {
    groupKey: 'pinned',
    paginationOpts: { numItems: 5, cursor: null },
  })
  expect(pinned.page.map((folder) => folder._id)).toEqual(['pin'] as never)
  expect(await get(ctx, { folderId: 'folder-34' as never })).toMatchObject({
    name: 'Folder 34',
  })
})

test('direct lookups and child listing enforce ownership and tolerate deleted selections', async () => {
  const { ctx } = fixture()
  expect(await get(ctx, { folderId: 'foreign' as never })).toBeNull()
  expect(await get(ctx, { folderId: 'deleted' as never })).toBeNull()
  await expect(
    page(ctx, {
      groupKey: 'foreign',
      paginationOpts: { numItems: 5, cursor: null },
    }),
  ).rejects.toThrow('Folder not found')
})
