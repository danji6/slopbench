import { _save, getBySessionAgent } from '@sb/convex/model/session/cache'
import { announceFolderContext } from '@sb/convex/model/session/folderAnnouncement'
import {
  getSessionWithWorkspace,
  workspaceKey,
} from '@sb/convex/model/session/folderContext'
import { begin, finish } from '@sb/convex/model/session/folderTransitions'
import { pin, reorder } from '@sb/convex/model/session/folders'
import { duplicate } from '@sb/convex/model/session/sessionDuplicate'
import { toListItem } from '@sb/convex/model/session/sessionQueries'
import { redeem } from '@sb/convex/model/session/shares'
import { getApprovals } from '@sb/convex/model/session/state'
import { describe, expect, test } from 'bun:test'

import { args, setup } from './session-folder-fixture'

describe('session folders', () => {
  test('pins are personal and shared members cannot change folder authority', async () => {
    const { ctx, row } = setup()
    await pin({ ...(ctx as object), userId: 'member' } as never, {
      sessionId: 's' as never,
      pinned: true,
    })
    expect(row('mem').groupKey).toBe('pinned')
    expect(row('own').groupKey).toBe('a')
    expect(
      (await getSessionWithWorkspace(ctx, 's' as never))?.workspace?.path,
    ).toBe('/a')
    await expect(
      begin(ctx, args({ subject: 'member', sessionId: 's', folderId: 'b' })),
    ).rejects.toThrow()
    await pin({ ...(ctx as object), userId: 'member' } as never, {
      sessionId: 's' as never,
      pinned: false,
    })
    expect(row('mem').groupKey).toBe('ungrouped')
  })

  test('joined sessions move independently during streaming and retain their folder across pins', async () => {
    const { ctx, row, tables } = setup()
    tables.streams = [{ _id: 'busy', sessionId: 's', status: 'streaming' }]
    const state = await begin(
      ctx,
      args({ subject: 'member', sessionId: 's', folderId: 'c' }),
    )
    expect(state.personalMoved).toBe(true)
    expect(state.needsSidecar).toBe(false)
    expect(row('mem').groupKey).toBe('c')
    expect(row('mem').folderId).toBe('c')
    expect(row('own').groupKey).toBe('a')
    expect(row('s').contextLock).toBeUndefined()
    expect(
      (await getSessionWithWorkspace(ctx, 's' as never))?.workspace?.path,
    ).toBe('/a')
    expect(row('cache')).toBeDefined()
    const memberCtx = { ...(ctx as object), userId: 'member' } as never
    const item = await toListItem(
      memberCtx,
      row('s') as never,
      undefined,
      undefined,
      'c' as never,
    )
    expect(item).toMatchObject({
      owned: false,
      folderId: 'c',
      folderName: 'Personal',
    })
    await pin(memberCtx, { sessionId: 's' as never, pinned: true })
    await pin(memberCtx, { sessionId: 's' as never, pinned: false })
    expect(row('mem').groupKey).toBe('c')
    // The owner's move cannot overwrite the member's personal organization.
    tables.streams = []
    const input = args({ sessionId: 's', folderId: 'b' })
    const prepared = await begin(ctx, input)
    await finish(ctx, {
      ...input,
      targetRevision: prepared.targetRevision,
      commit: true,
    })
    expect(row('mem').groupKey).toBe('c')
  })

  test('shared placement rejects sourced, foreign, and locked folders', async () => {
    const { ctx, row } = setup()
    row('c').sources = [{ id: 'root', path: '/c', label: 'c' }]
    await expect(
      begin(ctx, args({ subject: 'member', sessionId: 's', folderId: 'c' })),
    ).rejects.toThrow('without sources')
    row('c').sources = []
    row('c').contextLock = `${Date.now() + 60000}:locked`
    await expect(
      begin(ctx, args({ subject: 'member', sessionId: 's', folderId: 'c' })),
    ).rejects.toThrow('sources are being updated')
    expect(row('mem').folderId).toBeUndefined()
  })

  test('folders containing joined sessions cannot gain sources, including pinned sessions', async () => {
    const { ctx, row } = setup()
    await begin(ctx, args({ subject: 'member', sessionId: 's', folderId: 'c' }))
    row('member').role = 'admin'
    await pin({ ...(ctx as object), userId: 'member' } as never, {
      sessionId: 's' as never,
      pinned: true,
    })
    await expect(
      begin(
        ctx,
        args({
          subject: 'member',
          folderId: 'c',
          sources: [{ id: 'root', path: '/c', label: 'c' }],
        }),
      ),
    ).rejects.toThrow('Move shared sessions out')
    expect(row('c').contextLock).toBeUndefined()
  })

  test('deleting a personal shared folder preserves chats, owner workspace, and pins', async () => {
    const { ctx, row } = setup()
    await begin(ctx, args({ subject: 'member', sessionId: 's', folderId: 'c' }))
    await pin({ ...(ctx as object), userId: 'member' } as never, {
      sessionId: 's' as never,
      pinned: true,
    })
    const input = args({ subject: 'member', folderId: 'c', remove: true })
    await begin(ctx, input)
    expect(row('c')).toBeUndefined()
    expect(row('mem').folderId).toBeUndefined()
    expect(row('mem').groupKey).toBe('pinned')
    expect(row('s').folderId).toBe('a')
    expect(row('msg')).toBeDefined()
    await pin({ ...(ctx as object), userId: 'member' } as never, {
      sessionId: 's' as never,
      pinned: false,
    })
    expect(row('mem').groupKey).toBe('ungrouped')
  })

  test('redeeming an invite defaults to Ungrouped without resetting an existing placement', async () => {
    const { ctx, tables, row } = setup()
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('invite'),
    )
    const tokenHash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
    tables.sessionShares = [{ _id: 'share', sessionId: 's', tokenHash }]
    tables.userSessions = tables.userSessions!.filter(
      (member) => member._id !== 'mem',
    )
    const memberCtx = { ...(ctx as object), userId: 'member' } as never
    await redeem(memberCtx, { token: 'invite' })
    const joined = tables.userSessions!.find(
      (member) => member.userId === 'member',
    )!
    expect(joined.groupKey).toBe('ungrouped')
    expect(joined.folderId).toBeUndefined()
    await begin(ctx, args({ subject: 'member', sessionId: 's', folderId: 'c' }))
    await redeem(memberCtx, { token: 'invite' })
    expect(row(String(joined._id)).folderId).toBe('c')
  })

  test('moving clears path grants and caches, preserves chats, pins and shell rules, and updates children live', async () => {
    const { ctx, row } = setup()
    await pin(ctx, { sessionId: 's' as never, pinned: true })
    const input = args({ sessionId: 's', folderId: 'b' })
    const state = await begin(ctx, input)
    expect(state.needsSidecar).toBe(true)
    expect(
      (await getSessionWithWorkspace(ctx, 'child' as never))?.contextLock,
    ).toBeTruthy()
    await finish(ctx, {
      ...input,
      targetRevision: state.targetRevision,
      commit: true,
    })
    expect(row('s').folderId).toBe('b')
    expect(row('own').groupKey).toBe('pinned')
    expect(row('mem').groupKey).toBe('ungrouped')
    expect(row('msg').content).toBe('Preserve me')
    expect(row('state').toolApprovals).toEqual({
      shell: ['git status'],
      paths: undefined,
    })
    expect(row('cache')).toBeUndefined()
    expect(
      (await getSessionWithWorkspace(ctx, 'child' as never))?.workspace,
    ).toBeUndefined()
  })

  test('deleting a folder moves sessions to Ungrouped without deleting messages or pins', async () => {
    const { ctx, row } = setup()
    await pin(ctx, { sessionId: 's' as never, pinned: true })
    const input = args({ folderId: 'a', remove: true })
    await begin(ctx, input)
    await finish(ctx, { ...input, commit: true })
    expect(row('a')).toBeUndefined()
    expect(row('s').folderId).toBeUndefined()
    expect(row('own').groupKey).toBe('pinned')
    expect(row('msg')).toBeDefined()
    await pin(ctx, { sessionId: 's' as never, pinned: false })
    expect(row('own').groupKey).toBe('ungrouped')
  })

  test.each(['streams', 'messages'])(
    'rejects source transitions with active child %s',
    async (table) => {
      const { ctx, tables } = setup()
      ;(tables[table] ??= []).push({
        _id: 'busy',
        sessionId: 'child',
        status: 'processing',
      })
      await expect(
        begin(ctx, args({ folderId: 'a', remove: true })),
      ).rejects.toThrow('Wait for sessions')
    },
  )

  test('rejects a destination whose sources changed after move preparation', async () => {
    const { ctx, row } = setup()
    const input = args({ sessionId: 's', folderId: 'b' })
    const state = await begin(ctx, input)
    expect(state.needsSidecar).toBe(true)
    row('b').revision = Number(row('b').revision) + 1
    row('b').sources = [{ id: 'new', path: '/new', label: 'new' }]
    await expect(
      finish(ctx, {
        ...input,
        targetRevision: state.targetRevision,
        commit: true,
      }),
    ).rejects.toThrow('Destination sources changed')
    expect(row('s').folderId).toBe('a')
    await finish(ctx, { ...input, commit: false })
    expect(row('s').contextLock).toBeUndefined()
  })

  test('source revisions invalidate root and child approvals and partial cache writes', async () => {
    const { ctx, row } = setup()
    expect((await getApprovals(ctx, 'child' as never)).paths).toEqual([
      '/extra',
    ])
    row('a').revision = Number(row('a').revision) + 1
    expect((await getApprovals(ctx, 'child' as never)).paths).toBeUndefined()
    expect(
      await getBySessionAgent(ctx, 's' as never, 'agent' as never),
    ).toBeNull()
    await _save(ctx, {
      sessionId: 's' as never,
      agentId: 'agent' as never,
      items: [],
    })
    expect(row('cache').tools).toBeUndefined()
    expect(row('cache').workspaceRevision).toBe(
      workspaceKey(
        (await getSessionWithWorkspace(ctx, 's' as never))?.workspace,
      ),
    )
  })

  test('duplication cannot enter a locked folder', async () => {
    const { ctx, row } = setup()
    row('a').contextLock = `${Date.now() + 60000}:locked`
    await expect(duplicate(ctx, { sessionId: 's' as never })).rejects.toThrow(
      'sources are being updated',
    )
  })

  test('manual reorder rejects duplicate or foreign folder IDs', async () => {
    const { ctx, row } = setup()
    await expect(
      reorder(ctx, { folderIds: ['a', 'a', 'b'] as never }),
    ).rejects.toThrow()
    await expect(
      reorder(ctx, { folderIds: ['a', 'foreign'] as never }),
    ).rejects.toThrow()
    await reorder(ctx, { folderIds: ['b', 'a'] as never })
    expect(row('b').position).toBe(0)
  })
})

test('initial Ungrouped context does not replace an explicit history boundary', async () => {
  const { ctx, row } = setup()
  row('s').folderId = undefined
  const session = await getSessionWithWorkspace(ctx, 's' as never)
  expect(await announceFolderContext(ctx, session!)).toBeNull()
  expect(row('s').workspaceRevision).toBe('[]')
})

test.each([undefined, 'b'])(
  'chats without prior sources stay silent in folder %s',
  async (folderId) => {
    const { ctx, row, tables } = setup()
    row('s').folderId = folderId
    row('s').activeAgentId = 'agent'
    const originalMessages = structuredClone(tables.messages)

    for (let turn = 0; turn < 2; turn++) {
      const session = await getSessionWithWorkspace(ctx, 's' as never)
      expect(await announceFolderContext(ctx, session!)).toBeNull()
    }

    expect(tables.messages).toEqual(originalMessages)
    expect(row('s').announcedWorkspace).toBeUndefined()
  },
)
