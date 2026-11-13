import { expect } from 'bun:test'

import type { skillRequests } from './skill-requests'

export async function captureRequest(
  provider: string,
  request: NonNullable<
    Awaited<ReturnType<ReturnType<typeof skillRequests>['nextTurn']>>
  >,
) {
  const { dispatchLanguageModel } =
    await import('@cv/convex/model/tool/dispatchTransport')
  const { generateText } = await import('ai')
  const { getProviderOptions } =
    await import('@cv/convex/model/provider/options')
  const { applyPromptCaching } = await import('@cv/convex/model/provider/cache')
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
    {
      onRequest: (body) => {
        logged = parse(body)
      },
      fetch: capture,
    },
  )
  const prefix = applyPromptCaching(
    { systemPrompt: request.systemPrompt, messages: request.messages },
    provider,
  )
  await expect(
    generateText({
      ...options,
      model: request.toolRuntime
        ? await dispatchLanguageModel(
            options.languageModel,
            request.toolRuntime,
          )
        : options.languageModel,
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
