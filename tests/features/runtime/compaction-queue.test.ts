import type { Id } from '@sb/convex/_generated/dataModel'
import { executeCompact, sendMessage } from '@sb/convex/model/chat/send'
import { _claim, _handoff } from '@sb/convex/model/stream/lifecycleClaims'
import { _continue } from '@sb/convex/model/stream/lifecycleProgress'
import { _complete } from '@sb/convex/model/stream/lifecycleTerminal'
import { _getProviderHistory } from '@sb/convex/model/stream/reads'
import type { StreamExecutionArgs } from '@sb/convex/types'
import { expect, test } from 'bun:test'
import { skillsDatabase } from '~/tests/helpers/skills-db'

const sessionId = 'session' as Id<'sessions'>
const userId = 'owner' as Id<'users'>

function fixture() {
  const state = skillsDatabase()
  const { db, rows } = state
  let clock = 10
  const insert = db.insert
  db.insert = (table, fields) =>
    insert(table, { _creationTime: clock++, ...fields })

  rows('sessions').push({
    _id: sessionId,
    ownerId: userId,
    activeAgentId: 'agent',
  })
  rows('agents').push({ _id: 'agent', ownerId: userId, name: 'Agent' })
  rows('sessionAgents').push({
    _id: 'link',
    sessionId,
    agentId: 'agent',
  })
  rows('userSessions').push({
    _id: 'member',
    sessionId,
    userId,
    role: 'owner',
  })
  rows('messages').push({
    _id: 'history',
    _creationTime: 1,
    sessionId,
    sender: { type: 'user', id: userId },
    role: 'user',
    status: 'done',
    contextEligible: true,
  })
  return state
}

type Fixture = ReturnType<typeof fixture>

async function compact(state: Fixture) {
  const session = await state.ctx.db.get(sessionId)
  const streamId = await executeCompact(state.ctx, session!, userId)
  const stream = await state.ctx.db.get(streamId!)
  return { streamId: streamId!, generation: stream!.generation }
}

async function send(state: Fixture, silent = false) {
  return sendMessage(state.ctx, { sessionId, content: 'Next question', silent })
}

async function finish(state: Fixture, execution: StreamExecutionArgs) {
  const stream = await state.ctx.db.get(execution.streamId)
  await state.ctx.db.patch(stream!.state.processingContentId!, {
    parts: [{ type: 'text', text: 'Compacted history' }],
  })
  await _complete(state.ctx, execution)
}

test('accepts messages during compaction and reserves exactly one reply after completion', async () => {
  const state = fixture()
  const execution = await compact(state)
  const claimed = await _claim(state.ctx, execution)
  const first = await send(state)
  const second = await send(state)

  expect(state.rows('streams')).toHaveLength(1)
  expect(await state.ctx.db.get(first)).toMatchObject({ status: 'done' })
  expect(await state.ctx.db.get(second)).toMatchObject({ status: 'done' })
  expect(await state.ctx.db.get(execution.streamId)).toMatchObject({
    command: { kind: 'compact', followUpAfterCompact: true },
    contextBoundaryMessageId: 'history',
  })

  // A continuation must keep writing the summary, rather than consume arrivals.
  await _continue(state.ctx, execution)
  expect(await state.ctx.db.get(execution.streamId)).toMatchObject({
    state: { processingMessageId: claimed!.state.processingMessageId },
    contextBoundaryMessageId: 'history',
  })
  await finish(state, execution)

  const streams = state.rows('streams')
  expect(streams).toHaveLength(1)
  expect(streams[0]).toMatchObject({
    command: { kind: 'invoke' },
    contextBoundaryMessageId: first,
  })
  expect(
    await state.ctx.db.get(claimed!.state.processingMessageId),
  ).toMatchObject({
    type: 'summary',
    status: 'done',
    summaryBoundaryCreationTime: 1,
  })
  // The queued reply owns the completion notification.
  expect(state.rows('notifications')).toHaveLength(0)
})

test('preserves the compaction snapshot when a message arrives before the claim', async () => {
  const state = fixture()
  const execution = await compact(state)
  const messageId = await send(state)
  const claimed = await _claim(state.ctx, execution)

  expect(claimed).toMatchObject({
    contextBoundaryMessageId: 'history',
    contextBoundaryCreationTime: 1,
  })
  const compactHistory = await _getProviderHistory(state.ctx, execution)
  expect(compactHistory.map((message) => message._id)).toEqual([
    'history' as Id<'messages'>,
  ])
  await finish(state, execution)
  expect(state.rows('streams')[0]).toMatchObject({
    command: { kind: 'invoke' },
    contextBoundaryMessageId: messageId,
  })

  const followUp = await state.ctx.db.get(
    state.rows('streams')[0]!._id as Id<'streams'>,
  )
  const followUpExecution = {
    streamId: followUp!._id,
    generation: followUp!.generation,
  }
  const reply = await _claim(state.ctx, followUpExecution)
  expect(reply?.contextBoundaryMessageId).toBe(
    claimed!.state.processingMessageId,
  )
  const history = await _getProviderHistory(state.ctx, followUpExecution)
  expect(history.map((message) => message._id)).toContain(messageId)
  expect(history[0]?._id).toBe(claimed!.state.processingMessageId)
  expect(history.map((message) => message._id)).not.toContain('history')
})

test('a silent message does not request a reply after manual compaction', async () => {
  const state = fixture()
  const execution = await compact(state)
  await _claim(state.ctx, execution)
  const messageId = await send(state, true)
  await finish(state, execution)

  expect(await state.ctx.db.get(messageId)).toMatchObject({ status: 'done' })
  expect(state.rows('streams')).toHaveLength(0)
})

test('silent arrivals cannot cancel a reply requested by an earlier message', async () => {
  const state = fixture()
  const execution = await compact(state)
  await _claim(state.ctx, execution)
  await send(state)
  await send(state, true)
  await finish(state, execution)

  expect(state.rows('streams')).toHaveLength(1)
  expect(state.rows('streams')[0]?.command).toMatchObject({ kind: 'invoke' })
})

test('compaction without new messages finishes without invoking the agent', async () => {
  const state = fixture()
  const execution = await compact(state)
  await _claim(state.ctx, execution)
  await finish(state, execution)

  expect(state.rows('streams')).toHaveLength(0)
})

test('empty-summary handoffs keep queued messages outside the compaction boundary', async () => {
  const state = fixture()
  const execution = await compact(state)
  const claimed = await _claim(state.ctx, execution)
  await send(state)
  await _handoff(state.ctx, execution)
  const stream = await state.ctx.db.get(execution.streamId)
  const resumed = await _claim(state.ctx, {
    ...execution,
    generation: stream!.generation,
  })

  expect(resumed).toMatchObject({
    contextBoundaryMessageId: 'history',
    state: { processingMessageId: claimed!.state.processingMessageId },
    command: { kind: 'compact', followUpAfterCompact: true },
  })
})

test('an attachment-only message during automatic compaction requests a reply', async () => {
  const state = fixture()
  const execution = await compact(state)
  await state.ctx.db.patch(execution.streamId, {
    command: {
      kind: 'compact',
      autoCompact: true,
      preserveContextBoundary: true,
      followUpAfterCompact: false,
    },
  })
  await _claim(state.ctx, execution)
  const attachmentId = 'attachment' as Id<'attachments'>
  state.rows('attachments').push({
    _id: attachmentId,
    sessionId,
    uploaderId: userId,
    fileId: 'file',
    mediaType: 'image/png',
    filename: 'image.png',
  })
  const messageId = await sendMessage(state.ctx, {
    sessionId,
    content: '',
    attachments: [{ id: attachmentId }],
  })
  expect(await state.ctx.db.get(attachmentId)).toMatchObject({ messageId })
  await finish(state, execution)
  expect(state.rows('streams')).toHaveLength(1)
  expect(state.rows('streams')[0]).toMatchObject({
    command: { kind: 'invoke' },
    contextBoundaryMessageId: messageId,
  })
})
