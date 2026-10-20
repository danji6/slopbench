import { expect } from 'bun:test'

import type { skillRequests } from './skill-requests'

export async function captureRequest(
  provider: string,
  request: NonNullable<
    Awaited<ReturnType<ReturnType<typeof skillRequests>['nextTurn']>>
  >,
) {
  const { generateText } = await import('ai')
  const { getProviderOptions } =
    await import('@sb/convex/model/provider/options')
  const { applyPromptCaching } = await import('@sb/convex/model/provider/cache')
  let captured: Record<string, unknown> | undefined
  let logged: unknown
  const parse = (body: string) =>
    JSON.parse(body, (key, value) =>
      key === 'cache_control' ? undefined : value,
    )
  const capture = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    captured = parse(String(init?.body))
    throw new Error('Captured provider request')
  }) as unknown as typeof fetch
  const options = await getProviderOptions(
    'fixture-model',
    'auto',
    { providerId: provider, apiKey: 'fixture' },
    (body) => {
      logged = parse(body)
    },
    capture,
  )
  const prefix = applyPromptCaching(
    { systemPrompt: request.systemPrompt, messages: request.messages },
    provider,
  )
  await expect(
    generateText({
      ...options,
      model: options.languageModel,
      system: prefix.systemPrompt,
      allowSystemInMessages: true,
      messages: prefix.messages,
      tools: request.tools,
      maxRetries: 0,
    }),
  ).rejects.toThrow('Captured provider request')
  expect(captured).toBeDefined()
  expect(logged).toEqual(captured)
  return captured!
}
