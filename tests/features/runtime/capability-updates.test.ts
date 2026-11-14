import { resetSessionCache } from '@cv/convex/model/chat/commands'
import { prepareCapabilities } from '@cv/convex/model/stream/capabilities'
import { _complete } from '@cv/convex/model/stream/lifecycleTerminal'
import { capabilitySource } from '@cv/convex/model/tool/capabilitySource'
import { expect, spyOn, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { captureRequest } from '~/tests/helpers/provider-request'
import { skillRequests } from '~/tests/helpers/skill-requests'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'capability-updates-'))
  const state = skillRequests(root)
  state.agent.tools = []
  return {
    ...state,
    root,
    async dispose() {
      state.restore()
      await rm(root, { recursive: true, force: true })
    },
  }
}

test('a tool-free chat refreshes configuration and prompts without capability notes', async () => {
  const f = await fixture()
  try {
    await f.db.patch('session', { folderId: undefined, title: 'Fixture' })
    const first = (await f.nextTurn())!
    const source = () => f.rows('sessionCache')[0]!.capabilitySource
    const initialSource = source()
    expect(first.toolRuntime!.current.names).toEqual([])

    f.rows('mcpServers').push({
      _id: 'unselected',
      ownerId: 'owner',
      key: 'unselected',
      label: 'Unselected',
      transport: 'http',
      url: 'http://fixture',
      enabled: true,
    })
    expect((await f.repeat())!.messages).toEqual(first.messages)
    const refreshedSource = source()
    expect(refreshedSource).not.toBe(initialSource)

    f.agent.tools = ['web_search']
    const blocked = (await f.repeat())!
    expect(blocked.toolRuntime!.current.names).toEqual([])
    expect(blocked.messages).toEqual(first.messages)
    expect(source()).not.toBe(refreshedSource)

    const prompt = f.rows('prompts')[0]!.item as { content: string }
    let contextId = first.toolRuntime!.frozen.contextId
    for (const content of ['Updated instructions', 'New instructions']) {
      await _complete(f.ctx, f.execution)
      prompt.content = content
      expect(
        await resetSessionCache(f.ctx, { sessionId: 'session' as never }),
      ).toEqual({ queued: false })
      const refreshed = (await f.nextTurn())!
      expect(refreshed.systemPrompt).toBe(content)
      expect(refreshed.toolRuntime!.current.names).toEqual([])
      expect(refreshed.toolRuntime!.frozen.contextId).not.toBe(contextId)
      contextId = refreshed.toolRuntime!.frozen.contextId
    }
    expect(
      f.rows('messages').filter((row) => row.type === 'capabilities'),
    ).toHaveLength(0)
  } finally {
    await f.dispose()
  }
})

test('live selections append updates while OpenAI and Anthropic keep their tool prefix frozen', async () => {
  const f = await fixture()
  try {
    const first = (await f.nextTurn())!
    const frozen = structuredClone(first.toolRuntime!.frozen)
    expect(first.tools).toHaveProperty('get_tool')
    expect(first.tools).toHaveProperty('call_tool')
    expect(JSON.stringify(first.messages)).not.toMatch(/get_tool|call_tool/)
    expect(
      f.rows('messages').filter((row) => row.type === 'capabilities'),
    ).toHaveLength(0)
    f.agent.tools = ['todo']
    const second = (await f.repeat())!
    expect(second.toolRuntime!.current.names).toEqual([
      'write_todo',
      'edit_todo',
    ])
    expect(second.toolRuntime!.frozen).toEqual(frozen)
    expect(second.messages.slice(0, first.messages.length)).toEqual(
      first.messages,
    )
    expect(JSON.stringify(second.messages)).toContain(
      'Enabled: write_todo, edit_todo',
    )
    expect(JSON.stringify(second.messages.at(-1))).toContain(
      'Use get_tool({ name })',
    )
    expect(JSON.stringify(second.messages.at(-1))).toContain(
      'Use call_tool({ name, arguments })',
    )
    const definition = await second.tools.get_tool.execute!(
      { name: 'write_todo' },
      {} as never,
    )
    expect(JSON.parse(definition as string)).toMatchObject({
      name: 'write_todo',
      inputSchema: { type: 'object' },
    })
    for (const provider of ['openai', 'anthropic']) {
      const a = await captureRequest(provider, first)
      const b = await captureRequest(provider, second)
      expect(b.tools).toEqual(a.tools)
      expect(JSON.stringify(b.tools)).not.toContain('write_todo')
    }
    expect((await f.repeat())!.messages).toEqual(second.messages)
    f.agent.tools = []
    const third = (await f.repeat())!
    expect(third.toolRuntime!.frozen).toEqual(frozen)
    expect(third.messages.slice(0, second.messages.length)).toEqual(
      second.messages,
    )
    const removal = JSON.stringify(third.messages.at(-1))
    expect(removal).toContain('Disabled or unavailable: write_todo, edit_todo')
    expect(removal).toContain('Available targets: none.')
    expect(removal).not.toMatch(/get_tool|call_tool/)
    await expect(
      second.tools.write_todo.execute!({ todos: [] }, {} as never),
    ).rejects.toThrow('no longer enabled')
  } finally {
    await f.dispose()
  }
})

test('introduces session paths on live enablement and drops guidance when access is revoked', async () => {
  const f = await fixture()
  try {
    await f.db.patch('session', { folderId: undefined })
    const first = (await f.nextTurn())!
    expect(JSON.stringify(first.messages)).not.toContain('session://')

    f.agent.tools = ['process_attachments']
    const enabled = (await f.repeat())!
    expect(enabled.toolRuntime!.frozen).toEqual(first.toolRuntime!.frozen)
    expect(enabled.toolRuntime!.current.names).toEqual([
      'copy_attachment',
      'attach_file',
    ])
    expect(JSON.stringify(enabled.messages)).toContain('session://')
    const definition = await enabled.tools.get_tool.execute!(
      { name: 'copy_attachment' },
      {} as never,
    )
    expect(JSON.parse(definition as string)).toMatchObject({
      name: 'copy_attachment',
      inputSchema: { type: 'object' },
    })

    f.agent.tools = ['read_attachment']
    const disabled = (await f.repeat())!
    expect(disabled.toolRuntime!.current.names).toEqual(['read_attachment'])
    expect(JSON.stringify(disabled.messages)).not.toContain('session://')
    await expect(
      enabled.tools.get_tool.execute!({ name: 'copy_attachment' }, {} as never),
    ).rejects.toThrow('no longer enabled')
  } finally {
    await f.dispose()
  }
})

test('contract changes include dispatcher guidance until the native contract is restored', async () => {
  const f = await fixture()
  try {
    f.agent.tools = ['shell']
    const first = (await f.nextTurn())!
    await f.db.patch('agent', { shell: '/bin/zsh' })
    const updated = (await f.repeat())!
    expect(updated.toolRuntime!.frozen).toEqual(first.toolRuntime!.frozen)
    const update = JSON.stringify(updated.messages.at(-1))
    expect(update).toContain('Updated: shell.')
    expect(update).toContain('Use get_tool({ name })')
    expect(update).toContain('Use call_tool({ name, arguments })')

    await f.db.patch('agent', { shell: undefined })
    const restored = (await f.repeat())!
    const restoration = JSON.stringify(restored.messages.at(-1))
    expect(restoration).toContain('Updated: shell.')
    expect(restoration).not.toMatch(/get_tool|call_tool/)
  } finally {
    await f.dispose()
  }
})

test('notes introduced during a turn follow settled output and retain all earlier update notes', async () => {
  const f = await fixture()
  try {
    await f.nextTurn()
    const stream = f.rows('streams')[0]!
    const output = (stream.state as { processingMessageId: string })
      .processingMessageId
    const content = f
      .rows('messageContents')
      .find((row) => row.messageId === output)!
    content.parts = [
      { type: 'step-start' },
      { type: 'text', text: 'Already consumed output' },
    ]
    const previous = (await f.repeat())!
    f.agent.tools = ['todo']
    const updated = (await f.repeat())!
    expect(updated.messages.slice(0, previous.messages.length)).toEqual(
      previous.messages,
    )
    expect(updated.messages.at(-2)).toMatchObject({ role: 'assistant' })
    expect(updated.messages.at(-1)).toMatchObject({ role: 'system' })
    f.agent.tools = ['ask']
    const again = (await f.repeat())!
    expect(again.messages.slice(0, updated.messages.length)).toEqual(
      updated.messages,
    )
    expect(
      f.rows('messages').filter((row) => row.type === 'capabilities'),
    ).toHaveLength(2)
  } finally {
    await f.dispose()
  }
})

test('/eval rebuilds prompts, native definitions, and automatic catalogs through request preparation', async () => {
  const f = await fixture()
  try {
    f.agent.tools = ['skills']
    const directory = path.join(f.root, '.agents/skills/review')
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, 'SKILL.md'),
      '---\nname: review\ndescription: Review code\n---\nInstructions',
    )
    const first = (await f.nextTurn())!
    f.agent.tools = ['skills', 'todo']
    const before = (await f.repeat())!
    expect(before.toolRuntime!.frozen.names).not.toContain('write_todo')
    expect(JSON.stringify(before.messages)).toContain('Use call_tool(')
    const prompt = f.rows('prompts')[0]!.item as { content: string }
    prompt.content = 'Updated instructions'
    await _complete(f.ctx, f.execution)
    expect(
      await resetSessionCache(f.ctx, { sessionId: 'session' as never }),
    ).toEqual({ queued: false })
    const refreshed = (await f.nextTurn())!
    expect(refreshed.systemPrompt).toBe('Updated instructions')
    expect(refreshed.toolRuntime!.frozen.contextId).not.toBe(
      first.toolRuntime!.frozen.contextId,
    )
    expect(refreshed.toolRuntime!.frozen.names).toContain('write_todo')
    expect(JSON.stringify(refreshed.messages)).not.toMatch(/get_tool|call_tool/)
    expect(
      f.rows('messages').filter((row) => row.type === 'skills'),
    ).toHaveLength(2)
    expect(
      JSON.stringify(refreshed.messages).match(/Review code/g),
    ).toHaveLength(1)
  } finally {
    await f.dispose()
  }
})

test('unchanged skill configurations scan once per invocation and refresh an initially empty catalog', async () => {
  const f = await fixture()
  const fetch = spyOn(globalThis, 'fetch')
  try {
    f.agent.tools = ['skills']
    await f.nextTurn()
    const catalogCalls = () =>
      fetch.mock.calls.filter(([url]) =>
        String(url).endsWith('/toolkits/catalog'),
      ).length
    const before = catalogCalls()
    await f.repeat()
    expect(catalogCalls()).toBe(before)
    const directory = path.join(f.root, '.agents/skills/review')
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, 'SKILL.md'),
      '---\nname: review\ndescription: New skill\n---\nBody',
    )
    const next = (await f.nextTurn())!
    expect(next.toolRuntime!.current.names).toContain('list_skills')
    expect(next.toolRuntime!.frozen.names).not.toContain('list_skills')
    expect(JSON.stringify(next.messages)).toContain('New skill')
  } finally {
    fetch.mockRestore()
    await f.dispose()
  }
})

test('stale capability preparation cannot acknowledge newer configuration or insert a note', async () => {
  const f = await fixture()
  try {
    const first = (await f.nextTurn())!
    const data = await f.action.runQuery(
      (await import('@cv/convex/_generated/api')).internal.streams._getContext,
      f.execution,
    )
    const source = await capabilitySource(data!)
    f.agent.tools = ['todo']
    const before = structuredClone(f.rows('sessionCache'))
    expect(
      await prepareCapabilities(f.ctx, {
        ...f.execution,
        source,
        contextId: first.toolRuntime!.frozen.contextId!,
        manifest: first.toolRuntime!.current,
      }),
    ).toBe(false)
    expect(f.rows('sessionCache')).toEqual(before)
    expect(
      f.rows('messages').filter((row) => row.type === 'capabilities'),
    ).toHaveLength(0)
  } finally {
    await f.dispose()
  }
})

test('a dispatcher call approved before revocation cannot execute on resume', async () => {
  const f = await fixture()
  try {
    await f.nextTurn()
    f.agent.tools = ['shell']
    const prepared = (await f.repeat())!
    const runtime = prepared.toolRuntime!
    const { convertToModelMessages, generateText } = await import('ai')
    const { MockLanguageModelV4 } = await import('ai/test')
    const { dispatchLanguageModel, rememberWireCalls } =
      await import('@cv/convex/model/tool/dispatchTransport')
    const args = { command: 'pwd', description: 'Read the current directory' }
    const part = {
      type: 'tool-shell',
      toolCallId: 'approved',
      state: 'approval-responded',
      input: args,
      approval: { id: 'approval', approved: true },
      wireCall: {
        name: 'call_tool',
        input: { name: 'shell', arguments: args },
      },
    }
    rememberWireCalls([part], runtime)
    const messages = await convertToModelMessages(
      [{ id: 'assistant', role: 'assistant', parts: [part] } as never],
      { tools: runtime.tools },
    )
    f.agent.tools = []
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'Access was revoked' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      }),
    })
    await generateText({
      model: await dispatchLanguageModel(model, runtime),
      messages,
      tools: runtime.tools,
      maxRetries: 0,
    })
    const results = model.doGenerateCalls[0]!.prompt.filter(
      (message) => message.role === 'tool',
    ).flatMap((message) => message.content)
    expect(results).toContainEqual(
      expect.objectContaining({
        type: 'tool-result',
        toolName: 'call_tool',
        output: expect.objectContaining({ type: 'error-text' }),
      }),
    )
    expect(JSON.stringify(results)).toContain('no longer enabled')
  } finally {
    await f.dispose()
  }
})

test('toolkit selections and updates are announced without enabling companion tools', async () => {
  const f = await fixture()
  try {
    const { publish } = await import('@cv/convex/model/toolkits/publication')
    const { select } = await import('@cv/convex/model/toolkits/selection')
    await f.db.patch('owner', { subject: 'owner' })
    const first = (await f.nextTurn())!
    const toolkitId = await publish(f.ctx, {
      subject: 'owner',
      root: f.root,
      revision: 'first',
      manifest: '{"name":"Toolkit"}',
      connections: [],
    })
    await select(f.ctx, {
      agentId: f.agent._id as never,
      toolkitId,
      enabled: true,
    })
    const selected = (await f.repeat())!
    expect(selected.toolRuntime!.current.names).toEqual([])
    expect(selected.toolRuntime!.frozen).toEqual(first.toolRuntime!.frozen)
    const selection = JSON.stringify(selected.messages.at(-1))
    expect(selection).toContain('Toolkits enabled: Toolkit')
    expect(selection).not.toMatch(/get_tool|call_tool/)
    await publish(f.ctx, {
      subject: 'owner',
      toolkitId,
      previousRevision: 'first',
      root: f.root,
      revision: 'second',
      manifest: '{"name":"Updated toolkit"}',
      connections: [],
    })
    const updated = (await f.repeat())!
    const update = JSON.stringify(updated.messages.at(-1))
    expect(update).toContain('Toolkits updated: Updated toolkit')
    expect(update).not.toMatch(/get_tool|call_tool/)
    await select(f.ctx, {
      agentId: f.agent._id as never,
      toolkitId,
      enabled: false,
    })
    const removed = (await f.repeat())!
    expect(JSON.stringify(removed.messages.at(-1))).toContain(
      'Toolkits disabled or unavailable: Updated toolkit',
    )
    expect(removed.toolRuntime!.current.names).toEqual([])
  } finally {
    await f.dispose()
  }
})
