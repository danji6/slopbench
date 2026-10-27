import { sidecarAuthentication } from '@sb/sidecar/auth'
import type { createApp } from '@sb/sidecar/main'
import { beforeAll, expect, spyOn, test } from 'bun:test'

let app: ReturnType<typeof createApp>
const authorization = 'Bearer fixture-secret'
const providerPaths = [
  'prepare-transfer',
  'start',
  'status',
  'cancel',
  'disconnect',
  'models',
  'responses',
]

beforeAll(async () => {
  process.env.CHAT_SIDECAR_DATA_DIR ??= process.cwd()
  const { createApp } = await import('@sb/sidecar/main')
  app = createApp(sidecarAuthentication('fixture-secret'))
})

test('central routes require authentication before reaching shell or provider handlers', async () => {
  expect((await app.request('/health')).status).toBe(200)
  const paths = [
    ...providerPaths.map((path) => `/providers/chatgpt/${path}`),
    '/providers/chatgpt/host',
    '/shell/start',
    '/shell/stream',
  ]
  for (const path of paths) {
    const method = path === '/shell/stream' ? 'GET' : 'POST'
    expect((await app.request(path, { method })).status).toBe(401)
  }
})

test('provider validation retains concise errors without logging callback data', async () => {
  const log = spyOn(console, 'error').mockImplementation(() => {})
  try {
    for (const path of providerPaths) {
      const response = await app.request(`/providers/chatgpt/${path}`, {
        method: 'POST',
        headers: { authorization, 'Content-Type': 'application/json' },
        body: '{}',
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'Invalid provider request',
      })
    }
    expect(log).not.toHaveBeenCalled()
  } finally {
    log.mockRestore()
  }
})

test('shell routes preserve validation and missing-job status codes', async () => {
  const invalid = await app.request('/shell/poll', {
    method: 'POST',
    headers: { authorization, 'Content-Type': 'application/json' },
    body: '{}',
  })
  expect(invalid.status).toBe(400)
  const missing = await app.request(
    '/shell/stream?sessionId=fixture&jobId=missing',
    {
      headers: { authorization },
    },
  )
  expect(missing.status).toBe(404)
})
