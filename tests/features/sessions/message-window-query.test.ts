import type { Id } from '@cv/convex/_generated/dataModel'
import { messagesWindow } from '@cv/convex/model/chat/queries'
import { expect, test } from 'bun:test'
import { skillsDatabase } from '~/tests/helpers/skills-db'

async function fixture() {
  const { ctx, db } = skillsDatabase()
  const sessionId = (await db.insert('sessions', {
    ownerId: ctx.userId,
  })) as Id<'sessions'>
  await db.insert('userSessions', { sessionId, userId: ctx.userId })
  const ids: Id<'messages'>[] = []
  for (let i = 1; i <= 3; i++) {
    const id = await db.insert('messages', {
      sessionId,
      _creationTime: i,
      selectedVersion: 1,
    })
    ids.push(id as Id<'messages'>)
    for (let segmentIndex = 0; segmentIndex < 2; segmentIndex++) {
      await db.insert('messageContents', {
        sessionId,
        messageId: id,
        version: 1,
        segmentIndex,
        parts: [{ type: 'text', text: `${i}:${segmentIndex}` }],
      })
    }
  }
  return { ctx, sessionId, ids }
}

test('exclusive older anchors retain hasNewer even when the excluded message is the newest', async () => {
  const { ctx, sessionId, ids } = await fixture()
  const result = await messagesWindow(ctx, {
    sessionId,
    anchor: [sessionId, 3, ids[2]],
    anchorInclusive: false,
    anchorSegment: 0,
    direction: 'older',
    limit: 1,
  })
  expect(result.page.map((message) => message._id)).toEqual([ids[1]])
  expect(result.page[0].segments).toHaveLength(2)
  expect(result.hasOlder).toBe(true)
  expect(result.hasNewer).toBe(true)
  expect(result.atTail).toBe(false)
})

test('anchors remain inclusive by default and earlier-segment bounds preserve continuation flags', async () => {
  const { ctx, sessionId, ids } = await fixture()
  const result = await messagesWindow(ctx, {
    sessionId,
    anchor: [sessionId, 3, ids[2]],
    anchorSegment: 0,
    direction: 'older',
    limit: 1,
  })
  expect(result.page.map((message) => message._id)).toEqual([ids[2]])
  expect(
    result.page[0].segments.map((segment) => segment.segmentIndex),
  ).toEqual([0])
  expect(result.hasNewer).toBe(true)
  expect(result.hasOlder).toBe(true)
})

test('exclusive newer anchors count the excluded oldest message as older history', async () => {
  const { ctx, sessionId, ids } = await fixture()
  const result = await messagesWindow(ctx, {
    sessionId,
    anchor: [sessionId, 1, ids[0]],
    anchorInclusive: false,
    direction: 'newer',
    limit: 10,
  })
  expect(result.page.map((message) => message._id)).toEqual([ids[1], ids[2]])
  expect(result.hasOlder).toBe(true)
  expect(result.hasNewer).toBe(false)
})
