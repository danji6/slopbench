/// <reference types="bun-types" />
import { createExternalMcpTool } from '@sb/convex/model/tool/mcp'
import type { McpServer } from '@sb/core/types'
import { afterEach, expect, spyOn, test } from 'bun:test'

const entry = { name: 'fixture_echo', serverId: 'fixture', toolName: 'echo' }
const server: McpServer = {
  id: 'fixture',
  label: 'Fixture',
  url: 'http://127.0.0.1:8999/mcp',
  transport: 'http',
  enabled: true,
  tools: [{ name: 'echo' }],
}
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>> | undefined
afterEach(() => {
  fetchSpy?.mockRestore()
})

async function fixture() {
  let live: { server: McpServer; readOnly: boolean } | null = {
    server: structuredClone(server),
    readOnly: false,
  }
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ text: 'ok' }),
  )
  const tool = await createExternalMcpTool(entry, [server], async () => live)
  const execute = () =>
    tool.execute!({}, { toolCallId: 'call', messages: [], context: {} })
  return {
    execute,
    set: (next: typeof live) => {
      live = next
    },
    calls: fetchSpy,
  }
}

test('read-only mode allows tools without an explicit permission setting', async () => {
  const { execute, set, calls } = await fixture()
  set({ server, readOnly: true })
  expect(await execute()).toBe('ok')
  expect(calls).toHaveBeenCalledTimes(1)
})

test('normal mode permits opted-out tools; a live mode change denies them', async () => {
  const { execute, set, calls } = await fixture()
  const optedOut = {
    ...server,
    tools: [{ name: 'echo', allowInReadOnly: false }],
  }
  set({ server: optedOut, readOnly: false })
  expect(await execute()).toBe('ok')
  set({ server: optedOut, readOnly: true })
  await expect(execute()).rejects.toThrow('not allowed in read-only mode')
  expect(calls).toHaveBeenCalledTimes(1)
})

test('read-only permission is checked again on every invocation', async () => {
  const { execute, set, calls } = await fixture()
  set({
    server: { ...server, tools: [{ name: 'echo', allowInReadOnly: true }] },
    readOnly: true,
  })
  expect(await execute()).toBe('ok')
  set({
    server: { ...server, tools: [{ name: 'echo', allowInReadOnly: false }] },
    readOnly: true,
  })
  await expect(execute()).rejects.toThrow('not allowed in read-only mode')
  expect(calls).toHaveBeenCalledTimes(1)
})

test('removed servers and tools cannot execute through a cached manifest', async () => {
  const { execute, set, calls } = await fixture()
  set(null)
  await expect(execute()).rejects.toThrow('no longer configured')
  set({ server: { ...server, tools: [] }, readOnly: false })
  await expect(execute()).rejects.toThrow('no longer configured')
  set({ server: { ...server, tools: [] }, readOnly: true })
  await expect(execute()).rejects.toThrow('no longer configured')
  expect(calls).not.toHaveBeenCalled()
})
