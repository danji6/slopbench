import type { Id } from '@sb/convex/_generated/dataModel'
import type { ActionCtx, QueryCtx } from '@sb/convex/_generated/server'
import {
  generateTitle,
  regenerateTitle,
} from '@sb/convex/actions/session/title'
import { _getTitleContext } from '@sb/convex/model/session/title'
import { DEFAULT_TITLE_SYSTEM_PROMPT } from '@sb/core/title-generation'
import { expect, test } from 'bun:test'

const sessionId = 'session' as Id<'sessions'>

test.each([undefined, 'Return a short title in Italian.', ''])(
  'resolves the saved title system prompt with a default for missing settings: %s',
  async (titleSystemPrompt) => {
    const ctx = {
      db: {
        get: async () => ({ ownerId: 'owner' }),
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
    const requests: { messages: { role: string; content: string }[] }[] = []
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        requests.push(await request.json())
        return Response.json({
          id: 'title-response',
          object: 'chat.completion',
          created: 0,
          model: 'title-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Un fine settimana romano',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
      },
    })
    const ctx = {
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
