import type { Id } from '@cv/convex/_generated/dataModel'
import {
  beginDuplicate,
  claim,
  finish,
  sweep,
} from '@cv/convex/model/session/sessionFiles'
import { expect, test } from 'bun:test'
import { getFunctionName } from 'convex/server'
import { skillsDatabase } from '~/tests/helpers/skills-db'

const rootId = 'root' as Id<'sessions'>

function fixture() {
  const f = skillsDatabase()
  f.rows('users').push({ _id: 'owner', subject: 'owner', role: 'admin' })
  f.rows('sessions').push({ _id: rootId, ownerId: 'owner', title: 'Original' })
  f.rows('userSessions').push({
    _id: 'membership',
    sessionId: rootId,
    userId: 'owner',
    role: 'owner',
  })
  return f
}

test('an interrupted duplicate remains hidden until its file copy has succeeded', async () => {
  const f = fixture()
  f.rows('sessionTaskDirectories').push({
    _id: 'task',
    rootId,
    name: 'sunny-whale',
  })
  const token = `${Date.now() + 60_000}:duplicate`
  const prepared = await beginDuplicate(f.ctx, {
    sessionId: rootId,
    subject: 'owner',
    token,
  })
  const { operationId, sessionId } = prepared!
  expect(operationId).toBeDefined()
  expect((await f.db.get(sessionId))?.sessionFilesPending).toBe(true)
  expect((await f.db.get(rootId))?.contextLock).toBe(token)
  expect((await claim(f.ctx, operationId!, true))?.attempt).toBe(1)

  await f.db.patch(operationId!, { nextAttemptAt: 0 })
  await sweep(f.ctx)
  expect(
    f.scheduled.map(({ reference }) => getFunctionName(reference as never)),
  ).toContain('actions/sessions:_runSessionFileOperation')
  expect((await claim(f.ctx, operationId!, false))?.attempt).toBe(2)
  expect(await finish(f.ctx, operationId!, 1, true)).toBe(false)
  expect((await f.db.get(sessionId))?.sessionFilesPending).toBe(true)
  expect(await finish(f.ctx, operationId!, 2, true)).toBe(true)
  expect((await f.db.get(sessionId))?.sessionFilesPending).toBeUndefined()
  expect((await f.db.get(rootId))?.contextLock).toBeUndefined()
  expect(
    f.rows('sessionTaskDirectories').map((row) => [row.rootId, row.name]),
  ).toEqual([
    [rootId, 'sunny-whale'],
    [sessionId, 'sunny-whale'],
  ])
})

test('busy child work blocks duplication and failed deletion remains retryable', async () => {
  const f = fixture()
  f.rows('sessions').push({
    _id: 'child',
    ownerId: 'owner',
    parent: { sessionId: rootId },
  })
  f.rows('streams').push({ _id: 'child-stream', sessionId: 'child' })
  await expect(
    beginDuplicate(f.ctx, {
      sessionId: rootId,
      subject: 'owner',
      token: `${Date.now() + 60_000}:duplicate`,
    }),
  ).rejects.toThrow('Wait for sessions')
  expect(f.rows('sessionFileOperations')).toHaveLength(0)

  const id = (await f.db.insert('sessionFileOperations', {
    kind: 'delete',
    sessionId: rootId,
    nextAttemptAt: 0,
  })) as Id<'sessionFileOperations'>
  expect((await claim(f.ctx, id, false))?.attempt).toBe(1)
  expect(await finish(f.ctx, id, 1, false)).toBe(false)
  expect(await f.db.get(id)).toBeTruthy()
  await f.db.patch(id, { nextAttemptAt: 0 })
  expect((await claim(f.ctx, id, false))?.attempt).toBe(2)
  expect(await finish(f.ctx, id, 2, true)).toBe(true)
  expect(await f.db.get(id)).toBeNull()
})
