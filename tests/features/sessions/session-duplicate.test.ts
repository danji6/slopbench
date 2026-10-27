import type { Id } from '@sb/convex/_generated/dataModel'
import { duplicate } from '@sb/convex/model/session/sessions'
import { describe, expect, test } from 'bun:test'
import {
  MEMBER,
  OWNER,
  makeCtx,
  seedMembership,
  seedMessage,
  seedSession,
} from '~/tests/helpers/session-duplicate'

describe('sessions.duplicate', () => {
  test('copies transcript, links, plan and environment into a fresh owned session', async () => {
    const { ctx, tables } = makeCtx()
    seedSession(tables, {
      activeAgentId: 'agents_1',
      model: { id: 'model-a', label: 'Model A' },
      reasoningEffort: 'high',
      mode: 'plan',
      announcedMode: 'plan',
      lastMessagePreview: 'bye',
      firstMessagePreview: 'hi',
      folderId: 'folder_1',
      settings: { slowModeMs: 500, disabled: true },
    })
    tables.sessionFolders.push({
      _id: 'folder_1',
      ownerId: OWNER,
      name: 'Repo',
      revision: 1,
      sources: [{ id: 'root', path: '/repo', label: 'repo' }],
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
    expect(copy.model).toEqual({ id: 'model-a', label: 'Model A' })
    expect(copy.reasoningEffort).toBe('high')
    expect(copy.mode).toBe('plan')
    expect(copy.lastMessagePreview).toBe('bye')
    expect(copy.firstMessagePreview).toBe('hi')
    // Copies inherit their source folder without a sidecar rebind.
    expect(copy.folderId).toBe('folder_1')
    expect(copy.workspace).toBeUndefined()
    expect(copy.parent).toBeUndefined()
    // A copy starts enabled even when its source was disabled
    expect(copy.settings).toEqual({ slowModeMs: 500 })

    const membership = tables.userSessions.find(
      (row) => row.sessionId === sessionId && row.userId === OWNER,
    )!
    expect(membership.role).toBe('owner')
    expect(membership.groupKey).toBe('folder_1')
    expect(membership.pinned).toBeUndefined()
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
    expect(copied).not.toHaveProperty('appearanceId')
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
      fileId: 'file_used',
      storageId: 'blob_1',
      uploaderId: OWNER,
      sessionId: 'session_1',
      messageId,
      filename: 'image.png',
      mediaType: 'image/png',
    })
    tables.attachments.push({
      _id: 'att_staged',
      fileId: 'file_staged',
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
