import type { Id } from '@sb/convex/_generated/dataModel'
import type { ActionCtx, QueryCtx } from '@sb/convex/_generated/server'
import {
  generateTitle,
  regenerateTitle,
} from '@sb/convex/actions/session/title'
import { update } from '@sb/convex/model/session/sessionSettings'
import {
  _getRegenerateTitleContext,
  _getTitleContext,
  _patchTitle,
} from '@sb/convex/model/session/title'
import { DEFAULT_TITLE_SYSTEM_PROMPT } from '@sb/core/title-generation'
import { expect, test } from 'bun:test'
import { getFunctionName } from 'convex/server'
import { skillsDatabase } from '~/tests/helpers/skills-db'
import { startTitleProvider } from '~/tests/helpers/title-provider'

const sessionId = 'session' as Id<'sessions'>
const auth = { getUserIdentity: async () => ({ subject: 'member' }) }

test.each([undefined, 'Return a short title in Italian.', ''])(
  'resolves the saved title system prompt with a default for missing settings: %s',
  async (titleSystemPrompt) => {
    const ctx = {
      db: {
        get: async () => ({ _id: sessionId, ownerId: 'owner' }),
        query: () => ({
          withIndex: () => ({
            unique: async () =>
              titleSystemPrompt === undefined ? null : { titleSystemPrompt },
            order: () => ({ take: async () => [] }),
          }),
        }),
      },
    } as unknown as QueryCtx
    const context = await _getTitleContext(ctx, { sessionId })
    expect(context?.systemPrompt).toBe(
      titleSystemPrompt ?? DEFAULT_TITLE_SYSTEM_PROMPT,
    )
  },
)

test.each([DEFAULT_TITLE_SYSTEM_PROMPT, 'Return a short title in Italian.'])(
  'sends the resolved system prompt for automatic and regenerated titles: %s',
  async (systemPrompt) => {
    const { server, requests } = startTitleProvider()
    const ctx = {
      auth,
      runQuery: async () => ({
        exchange: 'User: Plan a weekend in Rome.',
        modelId: 'title-model',
        systemPrompt,
        credentials: {
          providerId: 'custom',
          baseURL: server.url.toString(),
          apiKey: 'fixture',
        },
      }),
      runMutation: async () => {},
    } as unknown as ActionCtx

    try {
      expect(await generateTitle(ctx, { sessionId })).toBe(
        'Un fine settimana romano',
      )
      expect(await regenerateTitle(ctx, { sessionId })).toBe(
        'Un fine settimana romano',
      )
      expect(requests).toHaveLength(2)
      for (const request of requests) {
        expect(request.messages[0]).toEqual({
          role: 'system',
          content: systemPrompt,
        })
      }
    } finally {
      await server.stop(true)
    }
  },
)

test('without a title model, automatic titles use the first message', async () => {
  const patches: unknown[] = []
  const ctx = {
    auth,
    runQuery: async () => ({
      exchange:
        'User: Plan a weekend in Rome.\nAssistant: Here are some ideas.',
      modelId: undefined,
      // Even stale credentials must not enable a provider call without a model.
      credentials: { providerId: 'unsupported-provider' },
    }),
    runMutation: async (_reference: unknown, args: unknown) => {
      patches.push(args)
    },
  } as unknown as ActionCtx

  expect(await generateTitle(ctx, { sessionId })).toBe('Plan a weekend in Rome')
  expect(patches).toEqual([{ sessionId, title: 'Plan a weekend in Rome' }])
  expect(await regenerateTitle(ctx, { sessionId })).toBe(
    'Plan a weekend in Rome',
  )
  expect(patches).toHaveLength(1)
})

function titleFixture(baseURL?: string) {
  const fixture = skillsDatabase({
    by_sessionId: ['_creationTime'],
    by_messageId_version_segment: ['messageId', 'version', 'segmentIndex'],
  })
  const { ctx, db, rows } = fixture
  rows('sessions').push({ _id: sessionId, ownerId: 'owner' })
  rows('users').push({ _id: 'member', subject: 'member' })
  rows('userSessions').push({ _id: 'membership', sessionId, userId: 'member' })
  if (baseURL) {
    rows('settings').push({
      _id: 'settings',
      ownerId: 'owner',
      titleModel: 'title-model',
    })
    rows('modelProviders').push({
      _id: 'provider',
      ownerId: 'owner',
      key: 'custom',
      enabled: true,
      baseURL,
      models: [{ id: 'title-model' }],
    })
    rows('credentials').push({
      _id: 'credential',
      ownerId: 'owner',
      scope: 'provider',
      ref: 'provider',
      apiKey: 'fixture',
    })
  }

  const action = {
    auth,
    runQuery: async (
      ref: Parameters<typeof getFunctionName>[0],
      args: never,
    ) => {
      switch (getFunctionName(ref)) {
        case 'sessions:_getTitleContext':
          return _getTitleContext(ctx, args)
        case 'sessions:_getRegenerateTitleContext':
          return _getRegenerateTitleContext(ctx, args)
        default:
          throw new Error(`Unexpected query ${getFunctionName(ref)}`)
      }
    },
    runMutation: async (_ref: unknown, args: never) => _patchTitle(ctx, args),
  } as unknown as ActionCtx

  const segmentReads: string[] = []
  const query = db.query
  db.query = (table) => {
    const cursor = query(table)
    if (table === 'messageContents') {
      const iterate = cursor[Symbol.asyncIterator].bind(cursor)
      cursor[Symbol.asyncIterator] = async function* () {
        for await (const row of iterate()) {
          segmentReads.push(row._id)
          yield row
        }
      }
    }
    return cursor
  }
  return { ...fixture, action, segmentReads }
}

function addMessage(
  fixture: ReturnType<typeof titleFixture>,
  role: 'user' | 'assistant',
  parts: unknown[][],
) {
  const messages = fixture.rows('messages')
  messages.push({
    _id: role,
    role,
    sessionId,
    selectedVersion: 2,
    _creationTime: messages.length,
  })
  fixture.rows('messageContents').push(
    ...parts.map((parts, segmentIndex) => ({
      _id: `${role}-${segmentIndex}`,
      messageId: role,
      version: 2,
      segmentIndex,
      parts,
    })),
  )
}

test('early titles send a bounded step snapshot and Regenerate reads the live opening exchange', async () => {
  const { server, requests } = startTitleProvider()
  const f = titleFixture(server.url.toString())
  const opening = 'Plan a weekend in Rome.'
  const userText = 'u'.repeat(500 - opening.length - 1)
  const snapshot = 's'.repeat(500)
  addMessage(f, 'user', [
    [
      { type: 'file', url: 'attachment:large' },
      { type: 'text', text: opening },
    ],
    [{ type: 'text', text: userText }],
    [{ type: 'text', text: 'unused user tail' }],
  ])
  addMessage(f, 'assistant', [
    [
      { type: 'reasoning', text: 'private reasoning' },
      { type: 'tool-shell', output: 'private output' },
      { type: 'text', text: 'The full reply.' },
    ],
  ])
  f.rows('messageContents').push({
    _id: 'old-user',
    messageId: 'user',
    version: 1,
    segmentIndex: 0,
    parts: [{ type: 'text', text: 'old version' }],
  })

  try {
    await generateTitle(f.action, {
      sessionId,
      assistantText: `${snapshot}ignored`,
    })
    expect(f.segmentReads).toEqual(['user-0', 'user-1'])
    expect(requests[0].messages.at(-1)?.content).toBe(
      `User: ${opening} ${userText}\nAssistant: ${snapshot}`,
    )

    f.segmentReads.length = 0
    await regenerateTitle(f.action, { sessionId })
    expect(f.segmentReads).toEqual(['user-0', 'user-1', 'assistant-0'])
    expect(requests[1].messages.at(-1)?.content).toBe(
      `User: ${opening} ${userText}\nAssistant: The full reply.`,
    )
  } finally {
    await server.stop(true)
  }
})

test('without a model, the fallback reads only user segments', async () => {
  const f = titleFixture()
  addMessage(f, 'user', [[{ type: 'text', text: 'Opening line\nMore text' }]])
  addMessage(f, 'assistant', [[{ type: 'text', text: 'The reply.' }]])

  expect(await generateTitle(f.action, { sessionId })).toBe('Opening line')
  expect(f.segmentReads).toEqual(['user-0'])
})

test('a blank exchange and a saved title both skip the automatic model request', async () => {
  const { server, requests } = startTitleProvider()
  const f = titleFixture(server.url.toString())
  addMessage(f, 'user', [[{ type: 'file', url: 'attachment:large' }]])
  addMessage(f, 'assistant', [[{ type: 'text', text: '  ' }]])
  try {
    expect(await generateTitle(f.action, { sessionId })).toBeUndefined()
    await f.db.patch(sessionId, { title: 'Already named' })
    f.segmentReads.length = 0
    expect(
      await generateTitle(f.action, {
        sessionId,
        assistantText: 'Useful text',
      }),
    ).toBeUndefined()
    expect(f.segmentReads).toEqual([])
    expect(requests).toEqual([])
  } finally {
    await server.stop(true)
  }
})

test('Regenerate checks membership before reading any transcript', async () => {
  const f = titleFixture()
  addMessage(f, 'user', [[{ type: 'text', text: 'Private opening' }]])
  f.rows('userSessions').length = 0
  await expect(regenerateTitle(f.action, { sessionId })).rejects.toMatchObject({
    data: { code: 404 },
  })
  expect(f.segmentReads).toEqual([])
})

test('a manual save during a title request wins on the session and membership', async () => {
  const requested = Promise.withResolvers<void>()
  const respond = Promise.withResolvers<void>()
  const { server } = startTitleProvider(async () => {
    requested.resolve()
    await respond.promise
  })
  const f = titleFixture(server.url.toString())
  addMessage(f, 'user', [[{ type: 'text', text: 'Plan a weekend in Rome.' }]])
  f.rows('userSessions').push({
    _id: 'owner-membership',
    sessionId,
    userId: 'owner',
    role: 'owner',
  })
  const generating = generateTitle(f.action, { sessionId })
  try {
    await Promise.race([
      requested.promise,
      generating.then(() => {
        throw new Error('No title request')
      }),
    ])
    await update(f.ctx, { sessionId, title: 'My title' })
    respond.resolve()
    await generating
    expect(await f.db.get(sessionId)).toMatchObject({ title: 'My title' })
    expect(await f.db.get('membership')).toMatchObject({ title: 'My title' })
  } finally {
    respond.resolve()
    await server.stop(true)
  }
})
