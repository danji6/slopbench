import {
  begin,
  finishPublish,
  mergePublishedAttachments,
} from '@cv/convex/model/attachmentTransfers'
import { cleanUpGeneratedAttachments } from '@cv/convex/model/attachments'
import { expect, test } from 'bun:test'
import { skillsDatabase } from '~/tests/helpers/skills-db'

const execution = { streamId: 'stream' as never, generation: 1 }
const call = {
  ...execution,
  callId: 'publish',
  kind: 'attach_file' as const,
  request: '["session://report.txt",null]',
  path: 'session://report.txt',
}
const upload = {
  storageId: 'blob' as never,
  filename: 'report.txt',
  mediaType: 'text/plain',
}

function fixture() {
  const { ctx, db, rows } = skillsDatabase()
  Object.assign(db, {
    system: { get: async () => ({ size: 6 }) },
  })
  rows('streams').push({
    _id: 'stream',
    generation: 1,
    sessionId: 'child',
    invokedBy: 'owner',
    agentId: 'agent',
    state: {
      phase: 'streaming',
      processingMessageId: 'message',
      processingContentId: 'content',
    },
  })
  rows('sessions').push(
    { _id: 'root', ownerId: 'owner' },
    { _id: 'child', ownerId: 'owner', parent: { sessionId: 'root' } },
  )
  rows('userSessions').push({
    _id: 'membership',
    sessionId: 'root',
    userId: 'owner',
  })
  rows('agents').push({ _id: 'agent', tools: ['process_attachments'] })
  rows('messages').push({
    _id: 'message',
    sessionId: 'child',
    selectedVersion: 1,
  })
  rows('messageContents').push({
    _id: 'content',
    messageId: 'message',
    version: 1,
    segmentIndex: 0,
    parts: [],
  })
  return { ctx, db, rows }
}

test('publishes once in the child response while sharing the root working directory', async () => {
  const f = fixture()
  const operation = await begin(f.ctx, call)
  expect(String(operation.rootId)).toBe('root')
  expect((await begin(f.ctx, call))._id).toBe(operation._id)
  const result = await finishPublish(f.ctx, operation._id, execution, upload)
  expect(await finishPublish(f.ctx, operation._id, execution, upload)).toEqual(
    result,
  )
  expect((await begin(f.ctx, call)).result).toEqual(result)
  expect(f.rows('attachments')).toHaveLength(1)

  const content = f.rows('messageContents')[0]!
  const stale = [{ type: 'text', text: 'Done.' }]
  const parts = mergePublishedAttachments(content.parts as unknown[], stale)
  expect(parts).toEqual([
    ...stale,
    expect.objectContaining({
      type: 'file',
      attachmentId: result.attachmentId,
      filename: 'report.txt',
    }),
  ])
  await f.db.patch('content', { parts })
  await cleanUpGeneratedAttachments(f.ctx, execution.streamId)
  expect(f.rows('attachments')[0]?.streamId).toBeUndefined()
  expect(f.rows('attachments')[0]?.sessionId).toBe('child')
})

test('rechecks membership, plan mode, selection, and execution before publication', async () => {
  const f = fixture()
  const operation = await begin(f.ctx, call)
  await f.db.patch('agent', { tools: ['read_attachment'] })
  await expect(
    finishPublish(f.ctx, operation._id, execution, upload),
  ).rejects.toThrow('no longer enabled')

  await f.db.patch('agent', { tools: ['process_attachments'] })
  await f.db.patch('root', { mode: 'plan' })
  await expect(
    finishPublish(f.ctx, operation._id, execution, upload),
  ).rejects.toThrow('plan mode')

  await f.db.patch('root', { mode: undefined })
  await f.db.patch('stream', { generation: 2 })
  await expect(
    finishPublish(f.ctx, operation._id, execution, upload),
  ).rejects.toThrow('no longer active')

  await f.db.patch('stream', { generation: 1, invokedBy: 'outside' })
  await expect(
    finishPublish(f.ctx, operation._id, execution, upload),
  ).rejects.toThrow('Not found')
  expect(f.rows('attachments')).toHaveLength(0)
})
