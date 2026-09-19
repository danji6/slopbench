import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildSidecar, resolveNodeBinary } from '../../scripts/sidecar'

let child: ReturnType<typeof Bun.spawn>
let root: string
let base: string
const secret = 'isolated-sidecar-fixture'

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'slopbench-eval-'))
  await writeFile(join(root, 'fixture.txt'), 'workspace fixture')
  const probe = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = probe.port!
  probe.stop(true)
  base = `http://127.0.0.1:${port}`
  const entry = await buildSidecar()
  child = Bun.spawn([resolveNodeBinary(), entry], {
    env: {
      PATH: process.env.PATH,
      SIDECAR_SECRET: secret,
      MCP_PORT: String(port),
      CHAT_SIDECAR_DATA_DIR: root,
    },
    stdout: 'ignore',
    stderr: 'pipe',
  })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      await fetch(`${base}/health`)
        .then((response) => response.ok)
        .catch(() => false)
    )
      return
    await Bun.sleep(50)
  }
  throw new Error('Fixture sidecar failed to start')
}, 15_000)

afterAll(async () => {
  child?.kill()
  if (child) await child.exited
  if (root) await rm(root, { recursive: true, force: true })
})

function evaluate(texts: string[], extra: Record<string, unknown> = {}) {
  return fetch(`${base}/eval/message`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parts: texts.map((text) => ({ type: 'text', text })),
      context: {},
      environment: {},
      ...extra,
    }),
  })
}

describe('packaged Node evaluation workers', () => {
  test('has no host globals, including through helper constructors', async () => {
    const response = await evaluate([
      "{{ [typeof process, typeof fetch, typeof require, typeof document, readFile.constructor('return typeof process')()] }}",
    ])
    expect(response.status).toBe(200)
    expect((await response.json()).parts[0].text).toBe(
      '["undefined","undefined","undefined","undefined","undefined"]',
    )
  })

  test('shares variables within a successful batch and isolates separate guests', async () => {
    const response = await evaluate([
      '{{ setVar("x", 42) }}',
      '{{ getVar("x") }}',
    ])
    expect(await response.json()).toMatchObject({
      parts: [{ text: '' }, { text: '42' }],
      environment: { x: 42 },
      dirty: true,
    })
    expect(
      (await (await evaluate(['{{ getVar("x") }}'])).json()).parts[0].text,
    ).toBe('')
  })

  test('does not return partial output or environment on failure', async () => {
    const response = await evaluate([
      '{{ setVar("x", 42) }}',
      '{{ missingName() }}',
    ])
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: 'Dynamic JavaScript failed or exceeded its resource limit',
    })
  })

  test('terminates unbounded JavaScript and stays available', async () => {
    const response = await evaluate(['#eval\nwhile (true) {}\n#end'])
    expect(response.status).toBe(422)
    expect((await fetch(`${base}/health`)).status).toBe(200)
    expect((await (await evaluate(['{{ 2 + 2 }}'])).json()).parts[0].text).toBe(
      '4',
    )
  }, 10_000)

  test('requires explicit filesystem authority, independent of guest context', async () => {
    const text = '{{ readFile("fixture.txt", false) }}'
    const denied = await evaluate([text], {
      context: { workDir: root, isAdmin: true },
    })
    expect((await denied.json()).parts[0].text).toBe('')
    const allowed = await evaluate([text], { authorizedWorkDir: root })
    expect((await allowed.json()).parts[0].text).toBe('workspace fixture')
    expect(
      (
        await evaluate(['{{ readFile("../outside") }}'], {
          authorizedWorkDir: root,
        })
      ).status,
    ).toBe(422)
  })

  test('requires authentication on real operational routes', async () => {
    for (const path of [
      '/eval/message',
      '/mcp',
      '/shell/stream',
      '/mcp-ext/list',
      '/workspace/read-file',
    ]) {
      expect((await fetch(`${base}${path}`, { method: 'POST' })).status).toBe(
        401,
      )
    }
  })
})
