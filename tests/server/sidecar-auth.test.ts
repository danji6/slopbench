import { sidecarRequest } from '@sb/convex/model/sidecar_transport'
import { sidecarAuthentication } from '@sb/sidecar/auth'
import { jobEnv } from '@sb/sidecar/shell/system-shell'
import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

describe('sidecar authentication', () => {
  const app = new Hono()
  app.get('/health', (c) => c.json({ ready: true }))
  app.use('*', sidecarAuthentication('fixture-secret'))
  app.all('*', (c) => c.json({ operational: true }))

  test('requires configuration before serving requests', () => {
    expect(() => sidecarAuthentication(undefined)).toThrow('SIDECAR_SECRET')
    expect(() => sidecarAuthentication(' ')).toThrow('SIDECAR_SECRET')
  })

  test('only readiness is public, including across HTTP methods', async () => {
    expect((await app.request('/health')).status).toBe(200)
    for (const path of [
      '/mcp',
      '/eval/message',
      '/mcp-ext/call',
      '/shell/stream',
      '/workspace/read-file',
      '/health',
    ]) {
      const response = await app.request(path, { method: 'POST' })
      expect(response.status).toBe(401)
    }
  })

  test('rejects missing and incorrect credentials without disclosing them', async () => {
    for (const authorization of ['', 'Bearer wrong', 'Bearer fixture-secreu']) {
      const response = await app.request('/mcp', { headers: { authorization } })
      expect(response.status).toBe(401)
      expect(await response.text()).toBe('{"error":"Unauthorized"}')
    }
    expect(
      (
        await app.request('/mcp', {
          headers: { authorization: 'Bearer fixture-secret' },
        })
      ).status,
    ).toBe(200)
  })

  test('internal requests preserve headers and disable redirects', () => {
    const init = sidecarRequest({ headers: { Accept: 'text/event-stream' } })
    expect(new Headers(init.headers).get('Authorization')).toBe(
      'Bearer slopbench-test-sidecar-credential',
    )
    expect(new Headers(init.headers).get('Accept')).toBe('text/event-stream')
    expect(init.redirect).toBe('error')
  })

  test('shell jobs do not inherit the sidecar credential', () => {
    expect(jobEnv().SIDECAR_SECRET).toBeUndefined()
    expect(
      jobEnv({ SIDECAR_SECRET: 'override' }).SIDECAR_SECRET,
    ).toBeUndefined()
  })
})
