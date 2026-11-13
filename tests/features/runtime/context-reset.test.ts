import type { Id } from '@cv/convex/_generated/dataModel'
import {
  drainCommandQueue,
  resetContext,
  resumeAgentMessage,
} from '@cv/convex/model/chat/commands'
import { deleteMessage } from '@cv/convex/model/chat/mutations'
import { retryMessage } from '@cv/convex/model/chat/retry'
import {
  executeCompact,
  invokeAgent,
  sendMessage,
} from '@cv/convex/model/chat/send'
import { insertMessage } from '@cv/convex/model/messageContents'
import { _claim } from '@cv/convex/model/stream/lifecycleClaims'
import { consumeInterjections } from '@cv/convex/model/stream/lifecycleProgress'
import { _complete } from '@cv/convex/model/stream/lifecycleTerminal'
import {
  _getProviderHistory,
  _hasActiveMedia,
} from '@cv/convex/model/stream/reads'
import { expect, test } from 'bun:test'
import { skillsDatabase } from '~/tests/helpers/skills-db'

const sessionId = 'session' as Id<'sessions'>
const userId = 'owner' as Id<'users'>
const agentId = 'agent' as Id<'agents'>

function fixture() {
  const state = skillsDatabase()
  const { db, ctx, rows } = state
  let clock = 1
  const insert = db.insert
  db.insert = (table, fields) =>
    insert(table, { _creationTime: clock++, ...fields })

  rows('sessions').push({
    _id: sessionId,
    ownerId: userId,
    activeAgentId: agentId,
    title: 'Existing session',
  })
  rows('agents').push({ _id: agentId, ownerId: userId, name: 'Agent' })
  rows('sessionAgents').push({ _id: 'link', sessionId, agentId })
  rows('userSessions').push({ _id: 'member', sessionId, userId, role: 'owner' })

  const message = async (text: string, role: 'user' | 'assistant' = 'user') =>
    (
      await insertMessage(
        ctx,
        {
          sessionId,
          sender:
            role === 'assistant'
              ? { type: 'agent', id: agentId }
              : { type: 'user', id: userId },
          role,
          status: 'done',
        },
        [{ type: 'text', text }],
      )
    ).messageId

  const claim = async (streamId: Id<'streams'>) => {
    const stream = await ctx.db.get(streamId)
    const execution = { streamId, generation: stream!.generation }
    const claimed = await _claim(ctx, execution)
    expect(claimed).not.toBeNull()
    return { execution, claimed: claimed! }
  }

  return { ...state, message, claim }
}

test('/new runs without an agent and refreshes session context without scheduling a turn', async () => {
  const { ctx, rows, message, scheduled } = fixture()
  await ctx.db.patch(sessionId, {
    activeAgentId: undefined,
    mode: 'plan',
    announcedMode: 'plan',
  })
  rows('sessionCache').push({ _id: 'cache', sessionId, agentId })
  const old = await message('Earlier message')

  expect(await resetContext(ctx, { sessionId })).toEqual({ queued: false })

  expect(rows('messages').map(({ _id }) => _id)).toContain(old)
  expect(rows('messages').at(-1)).toMatchObject({
    type: 'contextReset',
    hidden: true,
    contextEligible: false,
  })
  expect(rows('sessionCache')).toHaveLength(0)
  expect(await ctx.db.get(sessionId)).toMatchObject({
    mode: 'plan',
    announcedMode: undefined,
  })
  expect(rows('streams')).toHaveLength(0)
  expect(scheduled).toHaveLength(0)
})

test('/new marks the transcript at drain time, including messages received while queued', async () => {
  const { ctx, rows, message, claim } = fixture()
  const old = await message('Earlier message')
  const streamId = (await invokeAgent(ctx, { sessionId }))!
  const { execution } = await claim(streamId)
  expect(await resetContext(ctx, { sessionId })).toEqual({ queued: true })
  const chip = rows('messages').find((row) => row.type === 'command')!
  expect(chip.extra).toMatchObject({ name: 'new', status: 'queued' })
  const waiting = await message('Sent during the wait')

  await drainCommandQueue(ctx, { sessionId })
  expect(rows('messages').some((row) => row.type === 'contextReset')).toBe(
    false,
  )
  expect(
    (await _getProviderHistory(ctx, execution)).map((row) => row._id),
  ).toEqual([old])

  await _complete(ctx, execution)
  const followUp = rows('streams')[0]!._id as Id<'streams'>
  await _complete(ctx, (await claim(followUp)).execution)
  await drainCommandQueue(ctx, { sessionId })

  const marker = rows('messages').at(-1)!
  expect(marker.type).toBe('contextReset')
  expect(Number(marker._creationTime)).toBeGreaterThan(
    (await ctx.db.get(waiting))!._creationTime,
  )
  expect(await ctx.db.get(chip._id as Id<'messages'>)).toBeNull()
  const next = await claim((await invokeAgent(ctx, { sessionId }))!)
  expect(next.claimed.contextBoundaryMessageId).toBe(
    marker._id as Id<'messages'>,
  )
  expect(await _getProviderHistory(ctx, next.execution)).toEqual([])
})

test('deleting a queued /new during compaction cancels it', async () => {
  const { ctx, rows, message, claim } = fixture()
  await message('Earlier message')
  const { execution } = await claim(
    (await executeCompact(ctx, (await ctx.db.get(sessionId))!, userId))!,
  )
  expect(await resetContext(ctx, { sessionId })).toEqual({ queued: true })
  const chip = rows('messages').find((row) => row.type === 'command')!

  await deleteMessage(ctx, { messageId: chip._id as Id<'messages'> })
  await _complete(ctx, execution)
  await drainCommandQueue(ctx, { sessionId })

  expect(rows('messages').some((row) => row.type === 'contextReset')).toBe(
    false,
  )
  expect(rows('sessionState')[0]?.commandQueue).toEqual([])
})

test('a reset hides older summaries and media, and deletion restores the preceding summary', async () => {
  const { ctx, rows, message, claim } = fixture()
  const earlier = await message('Earlier message')
  const { messageId: summary } = await insertMessage(
    ctx,
    {
      sessionId,
      role: 'assistant',
      sender: { type: 'agent', id: agentId },
      type: 'summary',
      status: 'done',
    },
    [{ type: 'text', text: 'Earlier summary' }],
  )
  const withMedia = await message('Earlier attachment')
  rows('attachments').push({
    _id: 'attachment',
    messageId: withMedia,
    mediaType: 'image/png',
    filename: 'earlier.png',
  })
  await resetContext(ctx, { sessionId })
  const marker = rows('messages').at(-1)!._id as Id<'messages'>
  const later = await message('Later question')
  const { execution } = await claim((await invokeAgent(ctx, { sessionId }))!)
  const historyIds = async () =>
    (await _getProviderHistory(ctx, execution)).map((row) => row._id)

  expect(await historyIds()).toEqual([later])
  expect(await _hasActiveMedia(ctx, execution)).toBe(false)
  await deleteMessage(ctx, { messageId: marker })

  expect(await historyIds()).toEqual([summary, withMedia, later])
  expect(await _hasActiveMedia(ctx, execution)).toBe(true)
  expect(await ctx.db.get(earlier)).not.toBeNull()
  expect(await ctx.db.get(later)).not.toBeNull()
})

test('compaction after /new summarizes only its segment and applies on the next turn', async () => {
  const { ctx, message, claim } = fixture()
  await message('Earlier question')
  await resetContext(ctx, { sessionId })
  const recent = await message('Question after reset')
  const session = (await ctx.db.get(sessionId))!
  const compact = await claim((await executeCompact(ctx, session, userId))!)
  const output = compact.claimed.state.processingMessageId

  const compactHistory = await _getProviderHistory(ctx, compact.execution)
  expect(compactHistory.map((row) => row._id)).toEqual([recent])
  await ctx.db.patch(compact.claimed.state.processingContentId!, {
    parts: [{ type: 'text', text: 'Summary of the new segment' }],
  })
  await _complete(ctx, compact.execution)

  const later = await message('Follow-up question')
  const next = await claim((await invokeAgent(ctx, { sessionId }))!)
  const history = await _getProviderHistory(ctx, next.execution)
  expect(history.map((row) => row._id)).toEqual([output, later])
})

test.each(['retry', 'resume'] as const)(
  '%s uses the older reply history across a reset',
  async (operation) => {
    const { ctx, message, claim } = fixture()
    const earlier = await message('Earlier question')
    const reply = await message('Earlier reply', 'assistant')
    await insertMessage(
      ctx,
      {
        sessionId,
        role: 'assistant',
        sender: { type: 'agent', id: agentId },
        type: 'summary',
        status: 'done',
        summaryBoundaryCreationTime: (await ctx.db.get(earlier))!._creationTime,
      },
      [{ type: 'text', text: 'A summary created after the older reply' }],
    )
    await resetContext(ctx, { sessionId })
    await message('Later question')

    if (operation === 'retry') {
      await retryMessage(ctx, { messageId: reply })
    } else {
      await resumeAgentMessage(ctx, { sessionId })
    }
    await sendMessage(ctx, {
      sessionId,
      content: 'Sent while the historical turn is pending',
    })
    const streamId = (await ctx.db.query('streams').first())!._id
    const { execution, claimed } = await claim(streamId)
    expect(claimed.state.processingMessageId).toBe(reply)
    expect(claimed.contextBoundaryMessageId).toBe(earlier)
    const expected = operation === 'resume' ? [earlier, reply] : [earlier]
    expect(
      (await _getProviderHistory(ctx, execution)).map((row) => row._id),
    ).toEqual(expected)
    expect(await consumeInterjections(ctx, claimed)).toBe(false)
  },
)
