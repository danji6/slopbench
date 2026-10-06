import type { Id } from '@sb/convex/_generated/dataModel'
import type { FolderView } from '@sb/convex/types'
import {
  folderBranch,
  folderTrail,
  orderedFolderTree,
  projectFolderMove,
} from '@sb/core/utils/folder-tree'
import { expect, test } from 'bun:test'

import {
  folderDropAppearance,
  folderDropIntent,
  folderMoveConfirmed,
  folderMoveNeedsConfirmation,
} from '../../packages/client/src/lib/chat/folder-moves'
import { createSessionDrop } from '../../packages/client/src/lib/chat/session-drops'
import { flattenSessionTree } from '../../packages/client/src/lib/chat/session-groups'

const nodes = [
  { _id: 'a', name: 'A', position: 0 },
  { _id: 'b', name: 'B', position: 1 },
  { _id: 'n', name: 'Nested', parentId: 'a', position: 0 },
  { _id: 'g', name: 'Deep', parentId: 'n', position: 0 },
  { _id: 'sibling', name: 'Sibling', parentId: 'a', position: 1 },
]
const folderId = (id: string) => id as Id<'sessionFolders'>
const folders: FolderView[] = nodes.map((folder) => ({
  ...folder,
  _id: folderId(folder._id),
  parentId: folder.parentId ? folderId(folder.parentId) : undefined,
  _creationTime: 0,
  workspace: undefined,
  sources: [],
  revision: 0,
  ownerId: 'owner' as Id<'users'>,
  ancestorIds: folderTrail(nodes, folder._id)
    .slice(0, -1)
    .map((f) => f._id),
  folderPath: folderTrail(nodes, folder._id)
    .map((f) => f.name)
    .join(' / '),
}))
const page = (ids: string[], status = 'Exhausted') => ({
  results: ids.map((_id) => ({ _id })) as never,
  status,
})
const pages = {
  pinned: page(['pin']),
  a: page(['root']),
  n: page(['nested'], 'CanLoadMore'),
  g: page(['deep']),
  sibling: page([]),
  b: page([]),
  ungrouped: page([]),
}

test('ordered trees keep child branches contiguous and reject broken ancestry', () => {
  expect(orderedFolderTree(nodes).map(({ folder }) => folder._id)).toEqual([
    'a',
    'n',
    'g',
    'sibling',
    'b',
  ])
  expect(folderBranch(nodes, 'n').map((f) => f._id)).toEqual(['n', 'g'])
  expect(() =>
    folderTrail([{ ...nodes[0]!, parentId: 'missing' }], 'a'),
  ).toThrow('Invalid folder hierarchy')
  expect(() =>
    orderedFolderTree([
      { ...nodes[0]!, parentId: 'b' },
      { ...nodes[1]!, parentId: 'a' },
    ]),
  ).toThrow('Invalid folder hierarchy')
})

test('expanded trees show children before direct sessions with independent pagination', () => {
  const rows = flattenSessionTree(nodes, pages, {})
  expect(
    rows.map((row) =>
      row.kind === 'session' ? row.id : `${row.kind}:${row.key}`,
    ),
  ).toEqual([
    'header:pinned',
    'pin',
    'header:a',
    'header:n',
    'header:g',
    'deep',
    'nested',
    'footer:n',
    'header:sibling',
    'root',
    'header:b',
    'header:ungrouped',
  ])
  expect(
    rows.find((row) => row.kind === 'header' && row.key === 'a')?.last,
  ).toBe(false)
  expect(
    rows.find((row) => row.kind === 'session' && row.id === 'deep'),
  ).toMatchObject({ depth: 2, ancestorIds: ['a', 'n'], last: true })
  expect(
    rows.find((row) => row.kind === 'footer' && row.key === 'n')?.last,
  ).toBe(true)
})

test('collapsing a parent hides all descendants without disturbing Pinned', () => {
  const rows = flattenSessionTree(nodes, pages, { a: true })
  expect(
    rows.filter((row) => row.kind === 'header').map((row) => row.key),
  ).toEqual(['pinned', 'a', 'b', 'ungrouped'])
  expect(
    rows.filter((row) => row.kind === 'session').map((row) => row.id),
  ).toEqual(['pin'])
  expect(rows.find((row) => row.key === 'a')?.last).toBe(true)
  expect(
    flattenSessionTree(nodes, pages, { n: true }).some(
      (row) => row.key === 'g',
    ),
  ).toBe(false)
})

test('folder insertion lines follow the visible branch rather than its header', () => {
  const expanded = flattenSessionTree(nodes, pages, {})
  const target = { folderId: 'a', placement: 'after' as const }
  expect(
    expanded.filter((row) => folderDropAppearance(row, target).lineAfter),
  ).toEqual([expect.objectContaining({ kind: 'session', id: 'root' })])
  const collapsed = flattenSessionTree(nodes, pages, { a: true })
  expect(
    collapsed.filter((row) => folderDropAppearance(row, target).lineAfter),
  ).toEqual([expect.objectContaining({ kind: 'header', key: 'a' })])
  const childrenOnly = flattenSessionTree(
    nodes,
    { ...pages, a: page(['pin']) },
    {},
  )
  expect(
    childrenOnly.find((row) => row.key === 'sibling' && row.kind === 'header')
      ?.endingFolderIds,
  ).toEqual(['sibling', 'a'])
  expect(
    childrenOnly.filter((row) => folderDropAppearance(row, target).lineAfter),
  ).toHaveLength(1)
})

test('nesting highlights the whole branch while list insertion shows only a line', () => {
  const rows = flattenSessionTree(nodes, pages, {})
  expect(
    rows
      .filter(
        (row) =>
          folderDropAppearance(row, { folderId: 'n', placement: 'inside' })
            .highlighted,
      )
      .map((row) => row.key),
  ).toEqual(['n', 'g', 'g', 'n', 'n'])
  expect(
    rows.some(
      (row) =>
        folderDropAppearance(row, { folderId: 'n', placement: 'after' })
          .highlighted,
    ),
  ).toBe(false)
  expect(
    rows.filter(
      (row) =>
        folderDropAppearance(row, { folderId: 'n', placement: 'before' })
          .lineBefore,
    ),
  ).toEqual([expect.objectContaining({ kind: 'header', key: 'n' })])
})

test('nested drop outlines keep the destination depth and only its branch boundaries', () => {
  const rows = flattenSessionTree(nodes, pages, {})
  const appearances = rows.map((row) =>
    folderDropAppearance(row, { folderId: 'a', placement: 'inside' }),
  )
  const outlined = appearances.filter((appearance) => appearance.highlighted)
  expect(outlined.every((appearance) => appearance.depth === 0)).toBe(true)
  expect(outlined.filter((appearance) => appearance.first)).toHaveLength(1)
  expect(outlined.filter((appearance) => appearance.last)).toHaveLength(1)
  expect(rows.filter((_, index) => appearances[index]?.last)).toEqual([
    expect.objectContaining({ kind: 'session', id: 'root' }),
  ])
  const nested = rows.map((row) =>
    folderDropAppearance(row, { folderId: 'n', placement: 'inside' }),
  )
  expect(
    nested
      .filter((appearance) => appearance.highlighted)
      .every((appearance) => appearance.depth === 1),
  ).toBe(true)
  expect(nested.filter((appearance) => appearance.last)).toHaveLength(1)
})

test('collapsed and default folder highlights close their outlines', () => {
  const collapsed = flattenSessionTree(nodes, pages, { a: true })
  const header = collapsed.find((row) => row.key === 'a')!
  expect(
    folderDropAppearance(header, { folderId: 'a', placement: 'inside' }),
  ).toMatchObject({ first: true, last: true, highlighted: true })
  expect(
    folderDropAppearance(
      { kind: 'footer', key: 'ungrouped', last: true },
      { folderId: 'ungrouped', placement: 'inside' },
    ),
  ).toMatchObject({ last: true, highlighted: true })
})

test('folder drag edges insert siblings and centers nest while moving the whole branch', () => {
  const intent = folderDropIntent(folders, 'n', 'b', 'inside')!
  expect(intent).toMatchObject({ folderId: 'n', parentId: 'b' })
  const projected = projectFolderMove(folders, intent)
  expect(projected.find((f) => f._id === 'g')?.parentId).toBe(folderId('n'))
  expect(
    orderedFolderTree(projected).map(({ folder }) => String(folder._id)),
  ).toEqual(['a', 'sibling', 'b', 'n', 'g'])
  expect(folderDropIntent(folders, 'n', 'b', 'before')).toMatchObject({
    parentId: null,
    beforeFolderId: 'b',
  })
  expect(folderDropIntent(folders, 'n', 'b', 'after')).toMatchObject({
    parentId: null,
    beforeFolderId: undefined,
  })
  expect(folderDropIntent(folders, 'a', 'g', 'inside')).toBeNull()
  expect(folderDropIntent(folders, 'a', 'g', 'before')).toBeNull()
  expect(() =>
    projectFolderMove(folders, {
      folderId: 'n',
      parentId: 'b',
      beforeFolderId: 'g',
    }),
  ).toThrow('Folder list changed')
})

test('optimistic topology retains committed workspace context until server reconciliation', () => {
  const workspace: NonNullable<FolderView['workspace']> = {
    workspaceId: 'a',
    folderId: folderId('a'),
    path: '/a',
    label: 'A',
    revision: 1,
    sources: [{ id: 'root', path: '/a', label: 'A' }],
  }
  const sourced = folders.map((f) => ({
    ...f,
    workspace: ['a', 'n', 'g', 'sibling'].includes(f._id)
      ? workspace
      : undefined,
  }))
  const input = folderDropIntent(sourced, 'n', 'b', 'inside')!
  expect(folderMoveNeedsConfirmation(sourced, input)).toBe(true)
  expect(
    folderMoveNeedsConfirmation(sourced, {
      folderId: 'n' as never,
      parentId: 'sibling' as never,
    }),
  ).toBe(false)
  expect(
    folderMoveNeedsConfirmation(sourced, {
      folderId: 'n' as never,
      parentId: null,
    }),
  ).toBe(true)
  const projected = projectFolderMove(sourced, input)
  expect(projected.find((f) => f._id === 'n')?.workspace).toEqual(workspace)
  expect(folderMoveConfirmed(sourced, input)).toBe(false)
  expect(folderMoveConfirmed(projected, input)).toBe(true)
  expect(
    orderedFolderTree(sourced).find((e) => e.folder._id === 'g')?.path,
  ).toBe('A / Nested / Deep')
})

test('shared session drops reject folders with inherited sources', () => {
  expect(
    createSessionDrop({ _id: 'shared', owned: false } as never, 'n', {
      _id: 'n',
      name: 'Nested',
      sources: [],
      workspace: { workspaceId: 'a' },
    }),
  ).toBeNull()
  expect(
    createSessionDrop({ _id: 'shared', owned: false } as never, 'n', {
      _id: 'n',
      name: 'Nested',
      sources: [],
      folderPath: 'A / Nested',
    })?.item.folderPath,
  ).toBe('A / Nested')
})

test('a committed revision reconciles concurrent changes without restoring stale topology', () => {
  const input = folderDropIntent(folders, 'n', 'b', 'inside')!
  expect(folderMoveConfirmed(folders, input, 1)).toBe(false)
  const concurrent = folders.map((folder) =>
    folder._id === 'n'
      ? {
          ...folder,
          parentId: 'sibling' as Id<'sessionFolders'>,
          organizationRevision: 2,
        }
      : folder,
  )
  expect(folderMoveConfirmed(concurrent, input, 1)).toBe(true)
  expect(concurrent.find((folder) => folder._id === 'n')?.parentId).toBe(
    'sibling' as Id<'sessionFolders'>,
  )
})
