import {
  getSessionWithWorkspace,
  requireFolder,
  workspaceKey,
} from '@sb/convex/model/session/folderContext'
import { describeMove, preview } from '@sb/convex/model/session/folderMoves'
import { begin, finish } from '@sb/convex/model/session/folderTransitions'
import {
  create,
  createWithSources,
  list,
  reorder,
} from '@sb/convex/model/session/folders'
import { create as createSession } from '@sb/convex/model/session/sessions'
import type { FolderMoveArgs, FolderTransitionArgs } from '@sb/convex/types'
import { describe, expect, test } from 'bun:test'

import { type Row, args, setup } from './session-folder-fixture'

function nested() {
  const state = setup()
  state.tables.sessionFolders!.push(
    {
      _id: 'n',
      ownerId: 'owner',
      name: 'Nested',
      parentId: 'a',
      position: 0,
      sources: [],
      revision: 0,
    },
    {
      _id: 'g',
      ownerId: 'owner',
      name: 'Deep',
      parentId: 'n',
      position: 0,
      sources: [],
      revision: 0,
    },
    {
      _id: 'sibling',
      ownerId: 'owner',
      name: 'Sibling',
      parentId: 'a',
      position: 1,
      sources: [],
      revision: 0,
    },
  )
  state.row('s').folderId = 'g'
  state.row('own').groupKey = 'g'
  return state
}

async function run(
  ctx: Parameters<typeof begin>[0],
  input: FolderTransitionArgs,
) {
  const prepared = await begin(ctx, input)
  if (!prepared.personalMoved)
    await finish(ctx, { ...input, ...prepared, commit: true } as never)
  return prepared
}

async function moveArgs(ctx: Parameters<typeof preview>[0], extra: Row) {
  const input = { folderId: 'n', parentId: 'b', ...extra } as FolderMoveArgs
  const info = await describeMove(
    ctx,
    input,
    (ctx as unknown as { userId: never }).userId,
  )
  return args({ ...input, confirmationKey: info.confirmationKey })
}

describe('nested session folders', () => {
  test('workspace inheritance is live through multiple ancestors and sub-agent sessions', async () => {
    const { ctx, row } = nested()
    for (const id of ['s', 'child']) {
      const session = await getSessionWithWorkspace(ctx, id as never)
      expect(session?.folderId).toBe('g' as never)
      expect(session?.workspace).toMatchObject({
        workspaceId: 'a',
        folderId: 'a',
        path: '/a',
        revision: 1,
      })
    }
    row('a').sources = [{ id: 'next', path: '/next', label: 'Next' }]
    row('a').revision = 2
    expect(
      (await getSessionWithWorkspace(ctx, 's' as never))?.workspace?.path,
    ).toBe('/next')
    expect((await list(ctx)).find((f) => f._id === 'g')).toMatchObject({
      folderPath: 'A / Nested / Deep',
      ancestorIds: ['a', 'n'],
      sources: [],
      workspace: { workspaceId: 'a' },
    })
  })

  test('nested sub-agents retain root authority and intermediate session locks', async () => {
    const { ctx, tables, row } = nested()
    tables.sessions!.push({
      _id: 'grandchild',
      ownerId: 'owner',
      parent: { sessionId: 'child' },
    })
    expect(
      (await getSessionWithWorkspace(ctx, 'grandchild' as never))?.workspace
        ?.path,
    ).toBe('/a')
    row('child').contextLock = `${Date.now() + 60000}:locked`
    expect(
      (await getSessionWithWorkspace(ctx, 'grandchild' as never))?.contextLock,
    ).toBeTruthy()
    row('s').parent = { sessionId: 'grandchild' }
    await expect(
      getSessionWithWorkspace(ctx, 'grandchild' as never),
    ).rejects.toThrow('Invalid session hierarchy')
  })

  test('ancestor locks block creation and direct folder access', async () => {
    const { ctx, row } = nested()
    row('n').contextLock = `${Date.now() + 60000}:other`
    expect(
      (await getSessionWithWorkspace(ctx, 'child' as never))?.contextLock,
    ).toBeTruthy()
    await expect(
      requireFolder(ctx, 'g' as never, 'owner' as never),
    ).rejects.toThrow('sources are being updated')
    await expect(
      create(ctx, { name: 'Blocked', parentId: 'g' as never }),
    ).rejects.toThrow('sources are being updated')
    await expect(
      createSession(ctx, { folderId: 'g' as never }),
    ).rejects.toThrow('sources are being updated')
  })

  test('new sessions use inherited workspace defaults and nested folders cannot own sources', async () => {
    const { ctx, row } = nested()
    const result = await createSession(ctx, {
      folderId: 'g' as never,
      mode: 'plan',
      approvalMode: 'unrestricted',
    })
    expect(row(result.sessionId).mode).toBe('plan')
    expect(
      (await getSessionWithWorkspace(ctx, result.sessionId))?.workspace?.path,
    ).toBe('/a')
    await expect(
      createWithSources(ctx, {
        subject: 'owner',
        name: 'Invalid',
        parentId: 'g' as never,
        sources: [{ id: 'own', path: '/own', label: 'Own' }],
      }),
    ).rejects.toThrow('Subfolders inherit')
  })

  test('the folder limit counts every descendant', async () => {
    const { ctx, tables } = nested()
    for (
      let i = tables.sessionFolders!.filter(
        (f) => f.ownerId === 'owner',
      ).length;
      i < 100;
      i++
    )
      tables.sessionFolders!.push({
        _id: `limit-${i}`,
        ownerId: 'owner',
        name: 'Limit',
        parentId: 'g',
        position: i,
        sources: [],
        revision: 0,
      })
    await expect(
      create(ctx, { name: 'Overflow', parentId: 'g' as never }),
    ).rejects.toThrow('Folder limit reached')
  })

  test('creation appends within the selected sibling list and nested sources are rejected', async () => {
    const { ctx, tables, row } = nested()
    const id = await create(ctx, { name: 'Another', parentId: 'n' as never })
    expect(row(id)).toMatchObject({ parentId: 'n', position: 1, sources: [] })
    await expect(
      begin(ctx, args({ folderId: 'n', sources: [] })),
    ).rejects.toThrow('Subfolders inherit')
    await reorder(ctx, {
      parentId: 'a' as never,
      folderIds: ['sibling', 'n'] as never,
    })
    expect(row('n').position).toBe(1)
    expect(row('g').position).toBe(0)
    await expect(
      reorder(ctx, { parentId: 'a' as never, folderIds: ['g', 'n'] as never }),
    ).rejects.toThrow('Folder list changed')
    expect(tables.sessionFolders!.length).toBe(7)
  })

  test('same-workspace session and branch moves commit atomically during streaming', async () => {
    const { ctx, row, tables } = nested()
    tables.streams = [{ _id: 'busy', sessionId: 'child' }]
    const originalKey = workspaceKey(
      (await getSessionWithWorkspace(ctx, 's' as never))?.workspace,
    )
    const sessionMove = await begin(
      ctx,
      args({ sessionId: 's', folderId: 'sibling' }),
    )
    expect(sessionMove.personalMoved).toBe(true)
    expect(sessionMove.needsSidecar).toBe(false)
    expect(row('s').contextLock).toBeUndefined()
    row('s').folderId = 'g'
    const branchMove = await run(
      ctx,
      await moveArgs(ctx, { parentId: 'sibling' }),
    )
    expect(branchMove.personalMoved).toBe(true)
    expect(row('n').parentId).toBe('sibling')
    expect(row('n').contextLock).toBeUndefined()
    expect(row('cache')).toBeDefined()
    expect(row('state').toolApprovals).toMatchObject({ paths: ['/extra'] })
    expect(
      workspaceKey(
        (await getSessionWithWorkspace(ctx, 's' as never))?.workspace,
      ),
    ).toBe(originalKey)
  })

  test('cross-workspace moves guard all descendants and invalidate their context', async () => {
    const { ctx, row, tables } = nested()
    tables.streams = [{ _id: 'busy', sessionId: 'child' }]
    const input = await moveArgs(ctx, {})
    await expect(begin(ctx, input)).rejects.toThrow('Wait for sessions')
    expect(row('n').contextLock).toBeUndefined()
    tables.streams = []
    const prepared = await begin(ctx, input)
    expect(prepared.sessionIds).toEqual(['s', 'child'] as never)
    expect(prepared.needsSidecar).toBe(true)
    expect(
      (await getSessionWithWorkspace(ctx, 'child' as never))?.contextLock,
    ).toBeTruthy()
    await expect(
      create(ctx, { name: 'Blocked', parentId: 'g' as never }),
    ).rejects.toThrow()
    await finish(ctx, { ...input, ...prepared, commit: true } as never)
    expect(row('n').parentId).toBe('b')
    expect(row('g').parentId).toBe('n')
    expect(row('cache')).toBeUndefined()
    expect(row('state').toolApprovals).toMatchObject({
      shell: ['git status'],
      paths: undefined,
    })
    expect(
      (await getSessionWithWorkspace(ctx, 'child' as never))?.workspace,
    ).toBeUndefined()
  })

  test('promotion copies sources, requires admin and becomes independent', async () => {
    const { ctx, row } = nested()
    row('owner').role = 'user'
    const input = await moveArgs(ctx, { parentId: null })
    await expect(begin(ctx, input)).rejects.toThrow()
    row('owner').role = 'admin'
    await run(ctx, input)
    expect(row('n').parentId).toBeUndefined()
    expect(row('n').sources).toEqual(row('a').sources)
    expect(row('g').sources).toEqual([])
    expect(
      (await getSessionWithWorkspace(ctx, 's' as never))?.workspace
        ?.workspaceId,
    ).toBe('n')
    row('a').sources = []
    expect(
      (await getSessionWithWorkspace(ctx, 's' as never))?.workspace?.path,
    ).toBe('/a')
  })

  test('nesting a sourced root confirms replacing its own source configuration', async () => {
    const { ctx, row } = nested()
    const input = await moveArgs(ctx, { folderId: 'a', parentId: 'b' })
    await expect(
      begin(ctx, { ...input, confirmationKey: undefined }),
    ).rejects.toThrow('Review the workspace')
    row('owner').role = 'user'
    await expect(begin(ctx, input)).rejects.toThrow()
    row('owner').role = 'admin'
    await run(ctx, input)
    expect(row('a').sources).toEqual([])
    expect(row('a').parentId).toBe('b')
    expect(
      (await getSessionWithWorkspace(ctx, 's' as never))?.workspace,
    ).toBeUndefined()
  })

  test('cycles, foreign parents, stale sibling insertions, and nested transition locks are rejected', async () => {
    const { ctx, row } = nested()
    for (const extra of [
      { parentId: 'n' },
      { parentId: 'g' },
      { parentId: 'c' },
      { parentId: 'b', beforeFolderId: 'g' },
    ])
      expect(
        (await preview(ctx, { folderId: 'n', ...extra } as never)).ok,
      ).toBe(false)
    row('g').contextLock = `${Date.now() + 60000}:other`
    await expect(
      reorder(ctx, { folderIds: ['b', 'a'] as never }),
    ).rejects.toThrow('sources are being updated')
    expect(
      await preview(ctx, { folderId: 'n', parentId: 'b' } as never),
    ).toMatchObject({ ok: false, message: 'Folder sources are being updated' })
    await expect(
      begin(ctx, args({ folderId: 'a', sources: [] })),
    ).rejects.toThrow('sources are being updated')
    row('g').contextLock = undefined
    row('n').parentId = 'g'
    await expect(list(ctx)).rejects.toThrow('Invalid folder hierarchy')
  })

  test('destination authority is revalidated and rollback releases the branch lease', async () => {
    const { ctx, row } = nested()
    const input = await moveArgs(ctx, {})
    const prepared = await begin(ctx, input)
    row('b').sources = [{ id: 'new', path: '/new', label: 'New' }]
    row('b').revision = 1
    await expect(
      finish(ctx, { ...input, ...prepared, commit: true } as never),
    ).rejects.toThrow('Folder sources changed')
    await finish(ctx, { ...input, commit: false })
    expect(row('n').parentId).toBe('a')
    expect(row('n').contextLock).toBeUndefined()
    expect(row('cache')).toBeDefined()
  })

  test('a stale access confirmation cannot silently include newly added sessions', async () => {
    const { ctx, tables } = nested()
    const input = await moveArgs(ctx, {})
    tables.sessions!.push({ _id: 'new', ownerId: 'owner', folderId: 'n' })
    await expect(begin(ctx, input)).rejects.toThrow('Review the workspace')
  })

  test('organizational branch moves reject an in-flight session move', async () => {
    const { ctx, row } = nested()
    const input = await moveArgs(ctx, { parentId: 'sibling' })
    row('s').contextLock = `${Date.now() + 60000}:moving`
    await expect(begin(ctx, input)).rejects.toThrow('Session is being moved')
    expect(row('n').parentId).toBe('a')
  })

  test('source edits guard descendant sessions and joined placements, including pins', async () => {
    const { ctx, tables, row } = nested()
    tables.streams = [{ _id: 'busy', sessionId: 's' }]
    await expect(
      begin(ctx, args({ folderId: 'a', sources: [] })),
    ).rejects.toThrow('Wait for sessions')
    tables.streams = []
    await run(ctx, args({ folderId: 'a', sources: [] }))
    row('mem').folderId = 'g'
    row('mem').userId = 'owner'
    row('mem').groupKey = 'pinned'
    await expect(
      begin(
        ctx,
        args({
          folderId: 'a',
          sources: [{ id: 'new', path: '/new', label: 'New' }],
        }),
      ),
    ).rejects.toThrow('Move shared sessions out')
  })

  test('shared sessions cannot enter inherited sourced workspaces or be carried into one', async () => {
    const { ctx, row, tables } = nested()
    const memberCtx = { ...(ctx as object), userId: 'member' } as never
    tables.sessionFolders!.push({
      _id: 'personal-child',
      ownerId: 'member',
      name: 'Child',
      parentId: 'c',
      position: 0,
      sources: [],
      revision: 0,
    })
    row('c').sources = [{ id: 'member-root', path: '/member', label: 'Member' }]
    await expect(
      begin(
        ctx,
        args({ subject: 'member', sessionId: 's', folderId: 'personal-child' }),
      ),
    ).rejects.toThrow('without sources')
    row('c').sources = []
    await run(
      ctx,
      args({ subject: 'member', sessionId: 's', folderId: 'personal-child' }),
    )
    row('c').sources = [{ id: 'member-root', path: '/member', label: 'Member' }]
    tables.sessionFolders!.push({
      _id: 'other-personal',
      ownerId: 'member',
      name: 'Other',
      position: 1,
      sources: [],
      revision: 0,
    })
    row('personal-child').parentId = 'other-personal'
    const input = await moveArgs(memberCtx, {
      folderId: 'personal-child',
      parentId: 'c',
    })
    await expect(begin(ctx, { ...input, subject: 'member' })).rejects.toThrow(
      'Move shared sessions out',
    )
  })

  test('nested branch deletion keeps chats and pins in its parent during streaming', async () => {
    const { ctx, row, tables } = nested()
    row('own').pinned = true
    row('own').groupKey = 'pinned'
    tables.streams = [{ _id: 'busy', sessionId: 'child' }]
    const prepared = await run(ctx, args({ folderId: 'n', remove: true }))
    expect(prepared.needsSidecar).toBe(false)
    expect(row('n')).toBeUndefined()
    expect(row('g')).toBeUndefined()
    expect(row('s').folderId).toBe('a')
    expect(row('own').groupKey).toBe('pinned')
    expect(row('mem').groupKey).toBe('ungrouped')
    expect(row('msg')).toBeDefined()
    expect(row('cache')).toBeDefined()
    expect(
      (await getSessionWithWorkspace(ctx, 'child' as never))?.workspace?.path,
    ).toBe('/a')
  })

  test('root deletion covers descendants and preserves unrelated personal placement', async () => {
    const { ctx, row } = nested()
    row('mem').folderId = 'c'
    row('mem').groupKey = 'c'
    await run(ctx, args({ folderId: 'a', remove: true }))
    for (const id of ['a', 'n', 'g', 'sibling']) expect(row(id)).toBeUndefined()
    expect(row('s').folderId).toBeUndefined()
    expect(row('mem').folderId).toBe('c')
    expect(row('mem').groupKey).toBe('c')
    expect(row('msg')).toBeDefined()
    expect(row('cache')).toBeUndefined()
  })
})
