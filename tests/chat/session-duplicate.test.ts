/// <reference types="bun-types" />
import type { Id } from '@sb/convex/_generated/dataModel'
import {
  foreignStorageIds,
  removeAttachment,
} from '@sb/convex/model/attachments'
import { duplicate } from '@sb/convex/model/session/sessions'
import { describe, expect, test } from 'bun:test'

type Row = Record<string, unknown> & { _id: string }

type Ctx = {
  userId: Id<'users'>
  db: Record<string, unknown>
  storage: { delete: (id: string) => Promise<void> }
}

/** Multi-table stub with insert/patch/delete, index reads and filter support. */
function makeCtx() {
  const tables: Record<string, Row[]> = {
    sessions: [],
    userSessions: [],
    sessionAgents: [],
    plans: [],
    sessionState: [],
    messages: [],
    messageContents: [],
    attachments: [],
    streams: [],
  }
  const deletedBlobs: string[] = []
  let nextId = 1

  const all = () => Object.values(tables).flat()

  const ctx = {
    userId: 'users_1',
    storage: {
      delete: async (id: string) => void deletedBlobs.push(id),
    },
    db: {
      get: async (id: string) => all().find((row) => row._id === id) ?? null,
      insert: async (table: string, doc: Row) => {
        const _id = `${table}_${nextId++}`
        tables[table].push({ ...doc, _id, _creationTime: nextId })
        return _id
      },
      patch: async (id: string, patch: Row) => {
        const row = all().find((entry) => entry._id === id)
        if (!row) throw new Error(`patch target missing: ${id}`)
        Object.assign(row, patch)
      },
      delete: async (id: string) => {
        const table = Object.entries(tables).find(([, rows]) =>
          rows.some((row) => row._id === id),
        )
        if (!table) return
        tables[table[0]] = table[1].filter((row) => row._id !== id)
      },
      query: (table: string) => {
        const fullTable = {
          collect: async () => [...tables[table]],
          filter: null,
        }
        return Object.assign(fullTable, {
          withIndex: (_index: string, build?: (q: unknown) => unknown) => {
            const captured: Record<string, unknown> = {}
            const eqQuery = {
              eq: (field: string, value: unknown) => {
                captured[field] = value
                return eqQuery
              },
            }
            build?.(eqQuery)
            const indexed = tables[table].filter((row) =>
              Object.entries(captured).every(([key, value]) =>
                // `undefined` eq matches absent fields, like real indexes
                value === undefined
                  ? row[key] === undefined
                  : row[key] === value,
              ),
            )

            const applyFilter = (fn: (q: unknown) => boolean) =>
              indexed.filter((row) =>
                fn({
                  field: (f: string) => row[f],
                  eq: (a: unknown, b: unknown) => a === b,
                  neq: (a: unknown, b: unknown) => a !== b,
                }),
              )
            const sortBySegment = (rows: Row[], direction: string) =>
              [...rows].sort((a, b) =>
                direction === 'desc'
                  ? (b.segmentIndex as number) - (a.segmentIndex as number)
                  : (a.segmentIndex as number) - (b.segmentIndex as number),
              )

            let rows = indexed
            let direction = 'asc'
            const builder = {
              filter: (fn: (q: unknown) => boolean) => {
                rows = applyFilter(fn)
                return builder
              },
              order: (dir: string) => {
                direction = dir
                return builder
              },
              collect: async () => sortBySegment(rows, direction),
              unique: async () => rows[0] ?? null,
              first: async () => sortBySegment(rows, direction)[0] ?? null,
            }
            return builder
          },
        })
      },
    },
  } as never as Ctx

  return { ctx, tables, deletedBlobs }
}

const OWNER = 'users_1'
const MEMBER = 'users_2'

function seedSession(
  tables: Record<string, Row[]>,
  overrides: Record<string, unknown> = {},
): Row {
  const session = {
    ownerId: OWNER,
    title: 'Source',
    ...overrides,
    _id: 'session_1',
    _creationTime: 1,
  }
  tables.sessions.push(session)
  tables.userSessions.push({
    _id: 'us_source_owner',
    sessionId: session._id,
    userId: OWNER,
    role: 'owner',
  })
  return session
}

function seedMembership(tables: Record<string, Row[]>, userId: string) {
  tables.userSessions.push({
    _id: `us_${userId}`,
    sessionId: 'session_1',
    userId,
    role: 'member',
  })
}

let messageSeed = 0

function seedMessage(
  tables: Record<string, Row[]>,
  overrides: Record<string, unknown> & { sessionId: string },
  parts: unknown[],
) {
  const messageId = `msg_${++messageSeed}`
  tables.messages.push({
    sender: { type: 'user', id: OWNER },
    role: 'user',
    status: 'done',
    selectedVersion: 1,
    versionCount: 1,
    ...overrides,
    _id: messageId,
  })
  tables.messageContents.push({
    _id: `${messageId}_c0`,
    messageId,
    sessionId: overrides.sessionId,
    version: 1,
    segmentIndex: 0,
    parts,
  })
  return messageId
}

describe('sessions.duplicate', () => {
  test('copies transcript, links, plan and environment into a fresh owned session', async () => {
    const { ctx, tables } = makeCtx()
    seedSession(tables, {
      activeAgentId: 'agents_1',
      mode: 'plan',
      announcedMode: 'plan',
      turnCount: 4,
      lastMessagePreview: 'bye',
      firstMessagePreview: 'hi',
      workspace: { workspaceId: 'w1', label: 'repo', path: '/repo' },
      settings: { slowModeMs: 500, disabled: true },
    })
    tables.sessionAgents.push({
      _id: 'link_1',
      sessionId: 'session_1',
      agentId: 'agents_1',
      addedBy: OWNER,
    })
    tables.plans.push({
      _id: 'plan_1',
      sessionId: 'session_1',
      content: '# Plan',
      status: 'approved',
      dirty: true,
      updatedAt: 1,
    })
    tables.sessionState.push({
      _id: 'state_1',
      sessionId: 'session_1',
      environment: { varKey: 'value' },
      updatedAt: 1,
    })

    const textId = seedMessage(
      tables,
      { sessionId: 'session_1', senderName: 'Ada', appearanceId: 'look_1' },
      [{ type: 'text', text: 'hello' }],
    )
    // An older retry generation that must not be copied
    tables.messages[0].selectedVersion = 2
    tables.messages[0].versionCount = 2
    tables.messages[0].metadata = { duration: 12 }
    tables.messageContents.push({
      _id: 'msg_old_version_row',
      messageId: textId,
      sessionId: 'session_1',
      version: 1,
      segmentIndex: 0,
      parts: [{ type: 'text', text: 'stale generation' }],
    })
    tables.messageContents.find((row) => row._id === `${textId}_c0`)!.version =
      2

    const { sessionId } = await duplicate(ctx as never, {
      sessionId: 'session_1' as Id<'sessions'>,
    })

    const copy = tables.sessions.find((row) => row._id === sessionId)!
    expect(copy.title).toBe('Source (copy)')
    expect(copy.ownerId).toBe(OWNER)
    expect(copy.activeAgentId).toBe('agents_1')
    expect(copy.mode).toBe('plan')
    expect(copy.turnCount).toBe(4)
    expect(copy.lastMessagePreview).toBe('bye')
    expect(copy.firstMessagePreview).toBe('hi')
    // Workspace bindings are per-sidecar-registration and never copied
    expect(copy.workspace).toBeUndefined()
    expect(copy.parent).toBeUndefined()
    // A copy starts enabled even when its source was disabled
    expect(copy.settings).toEqual({ slowModeMs: 500 })

    const membership = tables.userSessions.find(
      (row) => row.sessionId === sessionId && row.userId === OWNER,
    )!
    expect(membership.role).toBe('owner')
    expect(membership.title).toBe('Source (copy)')
    expect(
      tables.sessionAgents.some((row) => row.sessionId === sessionId),
    ).toBe(true)

    const plan = tables.plans.find((row) => row.sessionId === sessionId)!
    expect(plan.content).toBe('# Plan')
    expect(plan.status).toBe('approved')
    expect(plan.dirty).toBe(true)

    const state = tables.sessionState.find(
      (row) => row.sessionId === sessionId,
    )!
    expect(state.environment).toEqual({ varKey: 'value' })

    const copies = tables.messages.filter((row) => row.sessionId === sessionId)
    expect(copies).toHaveLength(1)
    const [copied] = copies
    expect(copied.status).toBe('done')
    expect(copied.senderName).toBe('Ada')
    expect(copied.appearanceId).toBe('look_1')
    expect(copied.metadata).toEqual({ duration: 12 })
    // The selected generation becomes the copy's version 1
    expect(copied.versionCount).toBe(1)
    expect(copied.selectedVersion).toBe(1)
    const content = tables.messageContents.find(
      (row) => row.messageId === copied._id,
    )!
    expect(content.parts).toEqual([{ type: 'text', text: 'hello' }])
    expect(content.version).toBe(1)
    expect(content.segmentIndex).toBe(0)
    expect(tables.messages.find((row) => row._id === textId)).toBeTruthy()
  })

  test('skips command chips and processing leftovers', async () => {
    const { ctx, tables } = makeCtx()
    seedSession(tables)
    seedMessage(tables, { sessionId: 'session_1' }, [
      { type: 'text', text: 'a' },
    ])
    seedMessage(
      tables,
      { sessionId: 'session_1', type: 'command', extra: { status: 'ran' } },
      [],
    )
    seedMessage(tables, { sessionId: 'session_1', status: 'processing' }, [
      { type: 'text', text: 'half-written' },
    ])

    const { sessionId } = await duplicate(ctx as never, {
      sessionId: 'session_1' as Id<'sessions'>,
    })

    const contents = tables.messageContents.filter(
      (row) => row.sessionId === sessionId,
    )
    expect(contents).toHaveLength(1)
    expect(contents[0].parts).toEqual([{ type: 'text', text: 'a' }])
  })

  test('copies referenced media, remaps part ids and re-parents the copy', async () => {
    const { ctx, tables } = makeCtx()
    seedSession(tables)
    const messageId = seedMessage(tables, { sessionId: 'session_1' }, [
      { type: 'file', url: 'x', attachmentId: 'att_used' },
      { type: 'text', text: 'see attachment' },
    ])
    tables.attachments.push({
      _id: 'att_used',
      storageId: 'blob_1',
      uploaderId: OWNER,
      sessionId: 'session_1',
      messageId,
      filename: 'image.png',
      mediaType: 'image/png',
    })
    tables.attachments.push({
      _id: 'att_staged',
      storageId: 'blob_2',
      uploaderId: OWNER,
      sessionId: 'session_1',
      filename: 'staged.png',
      mediaType: 'image/png',
    })

    const { sessionId } = await duplicate(ctx as never, {
      sessionId: 'session_1' as Id<'sessions'>,
    })

    // Only the referenced attachment is copied; staged uploads are left alone
    const copies = tables.attachments.filter(
      (row) => row.sessionId === sessionId,
    )
    expect(copies).toHaveLength(1)
    const [attachmentCopy] = copies
    expect(attachmentCopy.storageId).toBe('blob_1')

    const [content] = tables.messageContents.filter(
      (row) => row.sessionId === sessionId,
    )
    const [filePart] = content.parts as Array<Record<string, unknown>>
    expect(filePart.attachmentId).toBe(attachmentCopy._id)

    const copiedMessage = tables.messages.find(
      (row) => row.sessionId === sessionId,
    )!
    expect(attachmentCopy.messageId).toBe(copiedMessage._id)
  })

  test('refuses non-owners', async () => {
    const { ctx, tables } = makeCtx()
    seedSession(tables)
    seedMembership(tables, MEMBER)

    const memberCtx = { ...ctx, userId: MEMBER }
    expect(
      duplicate(memberCtx as never, {
        sessionId: 'session_1' as Id<'sessions'>,
      }),
    ).rejects.toThrow()
  })

  test('refuses sub-agent child sessions', async () => {
    const { ctx, tables } = makeCtx()
    seedSession(tables, { parent: { sessionId: 'session_parent' } })

    expect(
      duplicate(ctx as never, {
        sessionId: 'session_1' as Id<'sessions'>,
      }),
    ).rejects.toThrow()
  })
})

describe('refcount-safe attachment removal', () => {
  test('keeps blobs another session references, frees unreferenced ones', async () => {
    const { ctx, tables, deletedBlobs } = makeCtx()
    tables.sessions.push(
      { _id: 's_src', ownerId: OWNER },
      {
        _id: 's_copy',
        ownerId: OWNER,
      },
    )
    tables.attachments.push(
      {
        _id: 'att_src',
        sessionId: 's_src',
        storageId: 'blob_shared',
        previewStorageId: 'thumb_shared',
      },
      {
        _id: 'att_copy',
        sessionId: 's_copy',
        storageId: 'blob_shared',
        previewStorageId: 'thumb_shared',
      },
    )

    const srcRow = tables.attachments[0]
    const shared = await foreignStorageIds(
      ctx as never,
      's_src' as Id<'sessions'>,
    )
    expect(shared.has('blob_shared' as never)).toBe(true)

    await removeAttachment(ctx as never, srcRow as never, shared)
    expect(deletedBlobs).not.toContain('blob_shared')
    expect(deletedBlobs).not.toContain('thumb_shared')
    expect(tables.attachments.some((row) => row._id === 'att_src')).toBe(false)

    // Once the copy goes too, nothing references the blobs anymore
    await removeAttachment(ctx as never, tables.attachments[0] as never)
    expect(deletedBlobs).toContain('blob_shared')
    expect(deletedBlobs).toContain('thumb_shared')
  })

  test('unshared blobs are freed immediately', async () => {
    const { ctx, tables, deletedBlobs } = makeCtx()
    tables.sessions.push({ _id: 's_solo', ownerId: OWNER })
    tables.attachments.push({
      _id: 'att_solo',
      sessionId: 's_solo',
      storageId: 'blob_private',
    })

    const shared = await foreignStorageIds(
      ctx as never,
      's_solo' as Id<'sessions'>,
    )
    await removeAttachment(ctx as never, tables.attachments[0] as never, shared)
    expect(deletedBlobs).toEqual(['blob_private'])
  })
})
