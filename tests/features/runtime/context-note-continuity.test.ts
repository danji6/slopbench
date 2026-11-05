import { prepareContextNote } from '@sb/convex/model/stream/contextNotes'
import { _claim, _continue, _handoff } from '@sb/convex/model/stream/lifecycle'
import {
  prepareProviderRequest,
  saveProviderContinuity,
} from '@sb/convex/model/stream/providerRequests'
import { _getProviderHistory } from '@sb/convex/model/stream/reads'
import type {
  ProviderContinuityScope,
  StreamExecutionArgs,
} from '@sb/convex/types'
import { expect, test } from 'bun:test'
import { skillsDatabase } from '~/tests/helpers/skills-db'

const execution = { streamId: 'stream', generation: 1 } as StreamExecutionArgs
const scope = {
  providerId: 'openai',
  ownerId: 'owner',
  connectionId: 'connection',
  model: 'model',
  cacheKeyHash: 'key-hash',
  messageId: 'output',
} as ProviderContinuityScope
const continuity = { token: 'fixture-turn-state', authRevision: 'fixture-auth' }

async function fixture() {
  const f = skillsDatabase()
  let clock = 30
  const insert = f.db.insert
  f.db.insert = (table, fields) =>
    insert(table, { ...fields, _creationTime: ++clock })
  f.rows('users').push({ _id: 'owner' })
  f.rows('agents').push({ _id: 'agent', name: 'Agent' })
  f.rows('messages').push({
    _id: 'output',
    _creationTime: 30,
    sessionId: 'session',
    role: 'assistant',
    sender: { type: 'agent', id: 'agent' },
    status: 'processing',
    selectedVersion: 1,
  })
  f.rows('messageContents').push({
    _id: 'content',
    sessionId: 'session',
    messageId: 'output',
    version: 1,
    segmentIndex: 0,
    parts: [{ type: 'text', text: 'Working on it' }],
  })
  f.rows('streams').push({
    _id: 'stream',
    _creationTime: 20,
    sessionId: 'session',
    agentId: 'agent',
    invokedBy: 'owner',
    generation: 1,
    attempt: 0,
    command: { kind: 'invoke' },
    state: {
      phase: 'streaming',
      processingMessageId: 'output',
      processingContentId: 'content',
    },
    contextBoundaryMessageId: 'user-message',
    contextBoundaryCreationTime: 10,
  })
  await prepareProviderRequest(f.ctx, { ...execution, scope })
  await saveProviderContinuity(f.ctx, {
    ...execution,
    scope,
    value: continuity,
    reset: false,
  })
  return f
}

test.each(['skills', 'workspace', 'mcp'] as const)(
  '%s context is already consumed without rolling over the turn or clearing routing state',
  async (type) => {
    const f = await fixture()
    await prepareContextNote(
      f.ctx,
      {
        ...execution,
        contextId: 'catalog',
        fingerprint: 'catalog',
        content: 'Prepared context',
      },
      type,
    )
    const before = await _getProviderHistory(f.ctx, execution)
    expect(before.map((message) => message.type)).toContain(type)
    const note = before.find((message) => message.type === type)
    expect(note?.parts).toEqual([
      { type: 'text', text: '<system-note>\nPrepared context\n</system-note>' },
    ])

    expect(await _continue(f.ctx, execution)).toBe(true)
    expect(await _getProviderHistory(f.ctx, execution)).toEqual(before)
    expect(f.rows('messages')).toHaveLength(2)
    expect(
      await prepareProviderRequest(f.ctx, { ...execution, scope }),
    ).toMatchObject({
      value: continuity,
      resetReason: 'none',
    })

    // Restarting an action runs the same interjection check during claim.
    expect(await _handoff(f.ctx, execution)).toBe(true)
    const resumed = { ...execution, generation: 2 }
    expect((await _claim(f.ctx, resumed))?.state.processingMessageId).toBe(
      scope.messageId,
    )
    expect(await _getProviderHistory(f.ctx, resumed)).toEqual(before)
    expect(
      await prepareProviderRequest(f.ctx, { ...resumed, scope }),
    ).toMatchObject({
      value: continuity,
      resetReason: 'none',
    })

    await prepareContextNote(
      f.ctx,
      {
        ...resumed,
        contextId: 'catalog',
        fingerprint: 'updated',
        content: 'Updated context',
      },
      type,
    )
    const parts = f.rows('messageContents').at(-1)?.parts as { text: string }[]
    expect(parts[0].text).toStartWith(
      '<system-note>\nUpdated context\n</system-note>',
    )
    if (type !== 'mcp') {
      expect(parts[0].text).toContain('<system-reminder>')
    }
  },
)

test.each([undefined, 'mode', 'reminder'] as const)(
  'real interjections (%s) still roll over when followed by a newer MCP context note',
  async (type) => {
    const f = await fixture()
    const interjectionId = await f.db.insert('messages', {
      sessionId: 'session',
      role: type ? 'system' : 'user',
      type,
      status: 'done',
    })
    await prepareContextNote(
      f.ctx,
      { ...execution, fingerprint: 'catalog', content: 'Prepared context' },
      'mcp',
    )

    expect(await _continue(f.ctx, execution)).toBe(true)
    const stream = await f.ctx.db.get(execution.streamId)
    const messageId = stream!.state.processingMessageId!
    expect(messageId).not.toBe(scope.messageId)
    expect(stream?.contextBoundaryMessageId).toBe(interjectionId as never)
    expect(
      await prepareProviderRequest(f.ctx, {
        ...execution,
        scope: { ...scope, messageId },
      }),
    ).toMatchObject({ value: undefined, resetReason: 'new-turn' })
  },
)
