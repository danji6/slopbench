import {
  type ProviderOptions,
  getProviderOptions,
} from '@sb/convex/model/provider/options'
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
  return new Response(
    `data: ${JSON.stringify({
      type: 'response.completed',
      response: {
        usage: {
          input_tokens: 2048,
          output_tokens: 2,
          input_tokens_details: { cached_tokens: 1024 },
        },
      },
    })}\n\n`,
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}

async function runRequest(options: ProviderOptions) {
  const result = streamText({
    model: options.languageModel,
    providerOptions: options.providerOptions,
    prompt: 'Reply OK',
    maxRetries: 0,
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
    expect(requests[0].body).not.toHaveProperty('prompt_cache_key')
    expect(requests[0].headers.get('Authorization')).toBe(
      'Bearer fixture-api-key',
    )
  })
})
