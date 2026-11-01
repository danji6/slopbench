import { createCacheDiagnostics } from '@sb/convex/actions/stream/cacheDiagnostics'
import { chatGPTFetch } from '@sb/convex/model/provider/openai/chatgpt'
import {
  type ProviderOptions,
  getProviderOptions,
} from '@sb/convex/model/provider/options'
import { accumulateSessionUsage } from '@sb/convex/model/stream/lifecycleMeta'
import { resolveUsage } from '@sb/convex/model/stream/usage'
import type { CacheDiagnostic } from '@sb/convex/types'
import { sidecarAuthentication } from '@sb/sidecar/auth'
import { sidecarError } from '@sb/sidecar/http-errors'
import { chatGPTResponses } from '@sb/sidecar/providers/openai/handlers'
import { saveRegistration } from '@sb/sidecar/providers/openai/storage'
import { streamText } from 'ai'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { streamDiagnosticsFixture } from '../../helpers/provider-diagnostics'

const key = { ownerId: 'fixture-owner', connectionId: 'fixture-connection' }
const credentials = { ...key, providerId: 'openai', auth: 'chatgpt' } as const
const sidecarURL = 'http://sidecar.fixture'
const route = '/providers/chatgpt/responses'
const originalEnvironment = {
  SLOPBENCH_AUTH_DIR: process.env.SLOPBENCH_AUTH_DIR,
  SIDECAR_URL: process.env.SIDECAR_URL,
}

type UpstreamRequest = {
  body: Record<string, unknown>
  headers: Headers
  redirect: RequestRedirect | undefined
}

let directory: string
let app: Hono
let requests: UpstreamRequest[]
let upstreamHeaders: Record<string, string>
let truncated: boolean
let upstreamStatus: number
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sb-cache-routing-'))
  process.env.SLOPBENCH_AUTH_DIR = directory
  process.env.SIDECAR_URL = sidecarURL
  await saveRegistration(key, {
    hostId: 'fixture-host',
    clientId: 'fixture-client',
    accessToken: 'fixture-oauth-token',
    scopes: ['chatgpt.tokens.use.direct'],
    expiresAt: Date.now() + 3_600_000,
  })
  requests = []
  upstreamHeaders = {}
  truncated = false
  upstreamStatus = 200
  app = new Hono()
  app.onError(sidecarError)
  app.use('*', sidecarAuthentication(process.env.SIDECAR_SECRET))
  app.post(route, chatGPTResponses)
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    captureFetch as typeof fetch,
  )
})

afterEach(async () => {
  fetchSpy?.mockRestore()
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  await rm(directory, { recursive: true, force: true })
})

async function captureFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input)
  if (url === `${sidecarURL}${route}`) return app.request(url, init)
  if (url !== 'https://api.openai.com/v1/responses') {
    throw new Error('Unexpected external request in cache routing test')
  }
  requests.push({
    body: JSON.parse(String(init?.body)),
    headers: new Headers(init?.headers),
    redirect: init?.redirect,
  })
  if (truncated)
    return new Response(
      'data: {"type":"response.created","response":{"id":"fixture-response"}}\n\n',
      { headers: upstreamHeaders },
    )
  if (upstreamStatus >= 400)
    return Response.json(
      { error: { message: 'fixture error' } },
      { status: upstreamStatus, headers: upstreamHeaders },
    )
  return new Response(
    `data: ${JSON.stringify({
      type: 'response.completed',
      response: {
        id: 'fixture-response',
        model: 'fixture-model',
        usage: {
          input_tokens: 2048,
          output_tokens: 2,
          input_tokens_details: { cached_tokens: 1024 },
        },
      },
    })}\n\n`,
    { headers: { 'Content-Type': 'text/event-stream', ...upstreamHeaders } },
  )
}

async function runRequest(options: ProviderOptions) {
  const result = streamText({
    model: options.languageModel,
    providerOptions: options.providerOptions,
    prompt: 'Reply OK',
    maxRetries: 0,
    onError: () => {},
  })
  return result.usage
}

function legacyRequest(body: Record<string, unknown>) {
  return app.request(`${sidecarURL}${route}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SIDECAR_SECRET}`,
      'Content-Type': 'application/json',
      'session-id': 'untrusted-incoming-header',
      'x-codex-turn-state': 'untrusted-turn-state',
    },
    body: JSON.stringify({ ...key, body }),
  })
}

describe('ChatGPT cache routing', () => {
  test('preserves session identity through the SDK, logging, sidecar and reconstructed models', async () => {
    const logs: string[] = []
    for (const cacheKey of [
      'session-a',
      'session-a',
      'child-session',
      'title:session-a',
    ]) {
      const options = await getProviderOptions(
        'fixture-model',
        'auto',
        credentials,
        {
          cacheKey,
          onRequest: (body) => {
            logs.push(body)
          },
        },
      )
      const usage = await runRequest(options)
      expect(usage.inputTokenDetails?.cacheReadTokens).toBe(1024)
    }
    expect(requests.map((request) => request.body.prompt_cache_key)).toEqual([
      'session-a',
      'session-a',
      'child-session',
      'title:session-a',
    ])
    for (const [index, request] of requests.entries()) {
      expect(request.body.prompt_cache_key).toBe(
        request.headers.get('session-id'),
      )
      expect(request.body).toEqual(JSON.parse(logs[index]))
      expect(request.headers.get('Authorization')).toBe(
        'Bearer fixture-oauth-token',
      )
      expect(request.headers.has('x-codex-turn-state')).toBe(false)
      expect(request.redirect).toBe('error')
    }
  })

  test('uses the explicit model key for both the body and header', async () => {
    const options = await getProviderOptions(
      'fixture-model',
      'auto',
      {
        ...credentials,
        model: {
          id: 'fixture-model',
          extraParameters: JSON.stringify({ prompt_cache_key: 'custom-cache' }),
        },
      },
      { cacheKey: 'session-default' },
    )
    await runRequest(options)
    expect(requests[0].body.prompt_cache_key).toBe('custom-cache')
    expect(requests[0].headers.get('session-id')).toBe('custom-cache')
  })

  test('reuses a fallback UUID for a transport and generates a new one for another transport', async () => {
    const first = await getProviderOptions('fixture-model', 'auto', credentials)
    await runRequest(first)
    await runRequest(first)
    await runRequest(
      await getProviderOptions('fixture-model', 'auto', credentials),
    )
    const keys = requests.map((request) => request.headers.get('session-id'))
    expect(keys[0]).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
    )
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
  })

  test('accepts legacy requests without a key and ignores incoming routing headers', async () => {
    const response = await legacyRequest({ model: 'fixture-model', input: [] })
    expect(response.status).toBe(200)
    await response.text()
    expect(requests[0].headers.has('session-id')).toBe(false)
    expect(requests[0].headers.has('x-codex-turn-state')).toBe(false)
    expect(requests[0].body).not.toHaveProperty('prompt_cache_key')
  })

  test.each([
    '',
    ' ',
    ' padded ',
    'cache\r\ninjected: header',
    'cache\0',
    'cache\u0001',
    '🔑',
    42,
    null,
  ])(
    'rejects an invalid key before contacting OpenAI: %j',
    async (cacheKey) => {
      const response = await legacyRequest({
        input: [],
        prompt_cache_key: cacheKey,
      })
      expect(response.status).toBe(400)
      expect(await response.text()).toContain('prompt_cache_key')
      expect(requests).toHaveLength(0)
    },
  )

  test('leaves API-key requests unaffected by the session cache default', async () => {
    const options = await getProviderOptions(
      'fixture-model',
      'auto',
      {
        providerId: 'openai',
        apiKey: 'fixture-api-key',
      },
      { cacheKey: 'session-default' },
    )
    await runRequest(options)
    expect(requests[0].headers.has('session-id')).toBe(false)
    expect(requests[0].headers.has('x-codex-turn-state')).toBe(false)
    expect(requests[0].body).not.toHaveProperty('prompt_cache_key')
    expect(requests[0].headers.get('Authorization')).toBe(
      'Bearer fixture-api-key',
    )
  })
})

describe('ChatGPT turn routing and diagnostics', () => {
  test('round-trips first state through reconstructed SDK models and correlates saved usage', async () => {
    const { ctx, rows, databaseCtx } = streamDiagnosticsFixture()
    for (let index = 0; index < 4; index++) {
      const messageId = index < 3 ? 'message' : 'next-turn'
      rows('streams')[0].state = {
        phase: 'streaming',
        processingMessageId: messageId,
      }
      rows('streams')[0].generation = index + 1
      const diagnostics = createCacheDiagnostics(ctx, {
        execution: { streamId: 'stream' as never, generation: index + 1 },
        messageId: messageId as never,
        attempt: 0,
        credentials,
      })
      upstreamHeaders = {
        'x-codex-turn-state': index === 1 ? 'conflicting-token' : 'first-token',
        'x-request-id': `request-${index}`,
        'openai-model': 'fixture-model',
        'x-private-upstream': 'must-not-forward',
      }
      const options = await getProviderOptions(
        'fixture-model',
        'auto',
        credentials,
        { cacheKey: 'session', observeTransport: diagnostics.observeTransport },
      )
      const result = streamText({
        model: options.languageModel,
        providerOptions: options.providerOptions,
        prompt: 'Reply OK',
        maxRetries: 0,
      })
      const normalized = await resolveUsage({
        usage: await result.usage,
        outputText: '',
      })
      const step = (await result.steps).at(-1)
      await diagnostics.complete(normalized, step?.usage, step?.response)
      await accumulateSessionUsage(
        databaseCtx,
        'session' as never,
        normalized,
        diagnostics.requestId(),
      )
      const log = rows('sessionState')[0].cacheDiagnostics as CacheDiagnostic[]
      expect(log.at(-1)).toMatchObject({
        outcome: 'completed',
        rawInputTokens: 2048,
        rawCacheReadTokens: 1024,
        cacheReadTokens: 1024,
        upstreamRequestId: `request-${index}`,
      })
      const responseHeaders = (await result.response).headers
      expect(responseHeaders).not.toHaveProperty('x-codex-turn-state')
      expect(responseHeaders).not.toHaveProperty('x-slopbench-auth-revision')
      expect(responseHeaders).not.toHaveProperty('x-private-upstream')
      expect(JSON.stringify(log)).not.toContain('first-token')
      expect(JSON.stringify(log)).not.toContain('fixture-oauth-token')
    }
    expect(
      requests.map((request) => request.headers.get('x-codex-turn-state')),
    ).toEqual([null, 'first-token', 'first-token', null])
    expect(
      (rows('sessionState')[0].cacheDiagnostics as CacheDiagnostic[])[1]
        .continuityConflict,
    ).toBe(true)
    const stream = rows('streams')[0]
    expect(stream.providerContinuity).toMatchObject({
      value: { token: 'first-token' },
    })
  })

  test('captures routing before a truncated stream and preserves it when a later response omits state', async () => {
    const { ctx, rows } = streamDiagnosticsFixture()
    const makeDiagnostics = () =>
      createCacheDiagnostics(ctx, {
        execution: { streamId: 'stream' as never, generation: 1 },
        messageId: 'message' as never,
        attempt: 0,
        credentials,
      })
    const first = makeDiagnostics()
    upstreamHeaders = { 'x-codex-turn-state': 'retry-token' }
    truncated = true
    const response = await chatGPTFetch(credentials, first.observeTransport)(
      'ignored',
      {
        body: JSON.stringify({
          model: 'fixture-model',
          input: [],
          prompt_cache_key: 'session',
        }),
      },
    )
    expect(rows('streams')[0].providerContinuity).toMatchObject({
      value: { token: 'retry-token' },
    })
    await expect(response.text()).rejects.toThrow()
    await first.fail(false)
    truncated = false
    upstreamHeaders = {}
    const next = makeDiagnostics()
    await (
      await chatGPTFetch(credentials, next.observeTransport)('ignored', {
        body: JSON.stringify({
          model: 'fixture-model',
          input: [],
          prompt_cache_key: 'session',
        }),
      })
    ).text()
    expect(requests[1].headers.get('x-codex-turn-state')).toBe('retry-token')
    expect(rows('streams')[0].providerContinuity).toMatchObject({
      value: { token: 'retry-token' },
    })
    expect(
      (rows('sessionState')[0].cacheDiagnostics as CacheDiagnostic[])[0]
        .outcome,
    ).toBe('stream_error')
  })

  test('drops old sign-in state, even if the connection ID is reused', async () => {
    const { ctx, rows } = streamDiagnosticsFixture()
    const invoke = async () => {
      const diagnostics = createCacheDiagnostics(ctx, {
        execution: { streamId: 'stream' as never, generation: 1 },
        messageId: 'message' as never,
        attempt: 0,
        credentials,
      })
      await runRequest(
        await getProviderOptions('fixture-model', 'auto', credentials, {
          cacheKey: 'session',
          observeTransport: diagnostics.observeTransport,
        }),
      )
    }
    upstreamHeaders = { 'x-codex-turn-state': 'old-sign-in' }
    await invoke()
    await saveRegistration(key, {
      hostId: 'fixture-host',
      clientId: 'fixture-client',
      accessToken: 'new-fixture-token',
      scopes: ['chatgpt.tokens.use.direct'],
      expiresAt: Date.now() + 3600000,
      authRevision: crypto.randomUUID(),
    })
    upstreamHeaders = { 'x-codex-turn-state': 'new-sign-in' }
    await invoke()
    expect(requests[1].headers.has('x-codex-turn-state')).toBe(false)
    expect(rows('streams')[0].providerContinuity).toMatchObject({
      value: { token: 'new-sign-in' },
    })
    expect(
      (rows('sessionState')[0].cacheDiagnostics as CacheDiagnostic[]).at(-1)
        ?.authReset,
    ).toBe(true)
  })

  test.each(['', ' padded ', 'bad\r\nheader', 'bad\0', '😀', 'a'.repeat(8193)])(
    'rejects invalid supplied turn state',
    async (token) => {
      const response = await app.request(`${sidecarURL}${route}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.SIDECAR_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...key,
          body: { input: [] },
          continuity: { token, authRevision: crypto.randomUUID() },
        }),
      })
      expect(response.status).toBe(400)
      expect(requests).toHaveLength(0)
    },
  )

  test('flags invalid upstream state without failing inference, and retains metadata on HTTP failures', async () => {
    const { ctx, rows } = streamDiagnosticsFixture()
    upstreamHeaders = { 'x-codex-turn-state': '' }
    const diagnostics = createCacheDiagnostics(ctx, {
      execution: { streamId: 'stream' as never, generation: 1 },
      messageId: 'message' as never,
      attempt: 0,
      credentials,
    })
    await runRequest(
      await getProviderOptions('fixture-model', 'auto', credentials, {
        cacheKey: 'session',
        observeTransport: diagnostics.observeTransport,
      }),
    )
    expect(rows('streams')[0].providerContinuity).toMatchObject({
      value: undefined,
    })
    expect(
      (rows('sessionState')[0].cacheDiagnostics as CacheDiagnostic[]).at(-1)
        ?.invalidContinuity,
    ).toBe(true)
    upstreamStatus = 500
    upstreamHeaders = {
      'x-codex-turn-state': 'error-token',
      'x-request-id': 'failed-request',
    }
    const failed = createCacheDiagnostics(ctx, {
      execution: { streamId: 'stream' as never, generation: 1 },
      messageId: 'message' as never,
      attempt: 0,
      credentials,
    })
    await expect(
      runRequest(
        await getProviderOptions('fixture-model', 'auto', credentials, {
          cacheKey: 'session',
          observeTransport: failed.observeTransport,
        }),
      ),
    ).rejects.toThrow()
    expect(rows('streams')[0].providerContinuity).toMatchObject({
      value: { token: 'error-token' },
    })
    expect(
      (rows('sessionState')[0].cacheDiagnostics as CacheDiagnostic[]).at(-1),
    ).toMatchObject({
      outcome: 'http_error',
      status: 500,
      upstreamRequestId: 'failed-request',
    })
  })
})
