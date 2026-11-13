import { rename } from '@cv/convex/model/session/folders'
import { consumeInterjections } from '@cv/convex/model/stream/lifecycleProgress'
import { dispatchLanguageModel } from '@cv/convex/model/tool/dispatchTransport'
import { generateText } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { captureRequest } from '~/tests/helpers/provider-request'
import { skillRequests } from '~/tests/helpers/skill-requests'

async function writeSkill(
  root: string,
  description: string,
  body = 'Original instructions',
) {
  const directory = path.join(root, '.agents/skills/review')
  await mkdir(directory, { recursive: true })
  await writeFile(
    path.join(directory, 'SKILL.md'),
    `---\nname: review\ndescription: ${description}\n---\n${body}`,
  )
}

test('enabling Skills in an existing chat makes assigned instructions readable through the dispatcher', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'assigned-skill-'))
  const fixture = skillRequests(root)
  const previousData = process.env.CHAT_SIDECAR_DATA_DIR
  process.env.CHAT_SIDECAR_DATA_DIR = path.join(root, 'data')
  try {
    await fixture.db.patch('session', { folderId: undefined })
    fixture.agent.tools = ['read_attachment']
    fixture.agent.home = { path: root, revision: 1 }
    const directory = path.join(root, 'skills', 'rewrite')
    await mkdir(directory, { recursive: true })
    const instructions =
      '---\nname: rewrite\ndescription: Revise prose\n---\nInstructions'
    await writeFile(path.join(directory, 'SKILL.md'), instructions)
    await fixture.db.insert('agentSkills', {
      homeId: 'fixture-home',
      ownerId: 'owner',
      skillId: 'skill',
      name: 'rewrite',
      description: 'Revise prose',
    })

    const before = (await fixture.nextTurn())!
    expect(before.toolRuntime!.current.names).toEqual(['read_attachment'])
    fixture.agent.tools.push('skills')
    const after = (await fixture.nextTurn('Use rewrite'))!
    const runtime = after.toolRuntime!
    expect(runtime.current.names).toEqual([
      'read_attachment',
      'list_skills',
      'read_skill',
    ])
    expect(runtime.frozen).toEqual(before.toolRuntime!.frozen)
    expect(JSON.stringify(after.messages)).toContain('rewrite@agent')
    expect(JSON.stringify(after.messages)).toContain(
      'Use read_skill with a skill_id',
    )
    const definition = runtime.current.definitions!.find(
      (tool) => tool.name === 'read_skill',
    )!
    const schema = JSON.parse(definition.inputSchema)
    expect(schema.required).toContain('skill_id')
    expect(schema.properties).not.toHaveProperty('uri')
    const catalog = await after.tools.list_skills.execute!({}, {} as never)
    expect(catalog).toMatchObject({
      entries: [{ name: 'rewrite', skill_id: 'rewrite@agent' }],
    })
    expect(catalog.entries[0]).not.toHaveProperty('path')

    const input = { skill_id: 'rewrite', offset: 0, length: 500 }
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'read',
            toolName: 'call_tool',
            input: JSON.stringify({ name: 'read_skill', arguments: input }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      }),
    })
    const result = await generateText({
      model: await dispatchLanguageModel(model, runtime),
      prompt: 'Use rewrite',
      tools: runtime.tools,
      maxRetries: 0,
    })
    expect(result.content.filter((part) => part.type === 'tool-error')).toEqual(
      [],
    )
    expect(result.toolResults).toMatchObject([
      {
        toolName: 'read_skill',
        output: { content: instructions, origin: 'agent' },
      },
    ])
    const read = (resource?: string) =>
      after.tools.read_skill.execute!(
        { skill_id: 'rewrite@agent', resource, offset: 0, length: 500 },
        {} as never,
      )

    expect(await read()).toMatchObject({ content: instructions })

    await expect(read('../../private.txt')).rejects.toThrow('inside this skill')
    await symlink(
      path.join(directory, 'SKILL.md'),
      path.join(directory, 'link.md'),
    )
    await expect(read('link.md')).rejects.toThrow('Symlink')
    await fixture.db.patch('agent', { disabledSkillIds: ['skill'] })
    await expect(read()).rejects.toThrow('Agent skill unavailable')
  } finally {
    fixture.restore()
    if (previousData === undefined) delete process.env.CHAT_SIDECAR_DATA_DIR
    else process.env.CHAT_SIDECAR_DATA_DIR = previousData
    await rm(root, { recursive: true, force: true })
  }
})

test('project edits and discovery toggles append context without rewriting the provider prefix', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-prefix-'))
  const fixture = skillRequests(root)
  try {
    await writeSkill(root, 'Review code')
    const first = (await fixture.nextTurn('Review this project'))!
    expect(first.systemPrompt).not.toContain('review/SKILL.md')
    expect(JSON.stringify(first.messages)).toContain('Review code')
    expect(
      fixture.rows('messages').filter((row) => row.type === 'skills'),
    ).toHaveLength(1)
    const initialNote = structuredClone(
      fixture
        .rows('messageContents')
        .find((row) => JSON.stringify(row.parts).includes('Review code')),
    )

    // Retries and subsequent tool steps reuse the persisted invocation snapshot.
    await writeSkill(root, 'Check changed code')
    const repeated = (await fixture.repeat())!
    expect(repeated.messages).toEqual(first.messages)
    expect(
      fixture.rows('messages').filter((row) => row.type === 'skills'),
    ).toHaveLength(1)

    const second = (await fixture.nextTurn())!
    expect(second.systemPrompt).toBe(first.systemPrompt)
    expect(second.toolRuntime!.frozen.definitions).toEqual(
      first.toolRuntime!.frozen.definitions,
    )
    expect(second.messages.slice(0, first.messages.length)).toEqual(
      first.messages,
    )
    expect(JSON.stringify(second.messages.at(-1))).toContain(
      'Check changed code',
    )
    expect(
      fixture
        .rows('messageContents')
        .find((row) => row._id === initialNote?._id),
    ).toEqual(initialNote)

    await writeSkill(root, 'Check changed code', 'Edited instructions')
    const third = (await fixture.nextTurn())!
    expect(JSON.stringify(third.messages.at(-1))).toContain(
      'Re-read the SKILL.md',
    )
    expect(
      fixture.rows('messages').filter((row) => row.type === 'skills'),
    ).toHaveLength(3)
    expect(third.messages.slice(0, second.messages.length)).toEqual(
      second.messages,
    )

    fixture.folder.sources[0]!.discoverSkills = false
    const fourth = (await fixture.nextTurn())!
    expect(fourth.systemPrompt).toBe(first.systemPrompt)
    expect(fourth.toolRuntime!.frozen.definitions).toEqual(
      first.toolRuntime!.frozen.definitions,
    )
    expect(fourth.messages.slice(0, third.messages.length)).toEqual(
      third.messages,
    )
    expect(JSON.stringify(fourth.messages.at(-1))).toContain(
      'No skills are currently available',
    )
  } finally {
    fixture.restore()
    await rm(root, { recursive: true, force: true })
  }
})

test('compaction and agent changes reannounce skill context, and stale generations cannot persist notes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-prefix-'))
  const fixture = skillRequests(root)
  try {
    await writeSkill(root, 'Review code')
    await fixture.nextTurn()
    fixture.agent._id = 'another-agent'
    await fixture.nextTurn()
    expect(
      fixture.rows('messages').filter((row) => row.type === 'skills'),
    ).toHaveLength(2)
    await fixture.compact()
    await fixture.nextTurn()
    expect(
      fixture.rows('messages').filter((row) => row.type === 'skills'),
    ).toHaveLength(3)
    const stream = fixture.rows('streams')[0]!
    stream.generation = 2
    const before = fixture.rows('messages').length
    expect(await fixture.repeat()).toBeNull()
    expect(fixture.rows('messages')).toHaveLength(before)
  } finally {
    fixture.restore()
    await rm(root, { recursive: true, force: true })
  }
})

test('skill notes do not interrupt tool execution, and listing rechecks live discovery and permissions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-prefix-'))
  const fixture = skillRequests(root)
  try {
    await writeSkill(root, 'Review code')
    const request = (await fixture.nextTurn())!
    expect(
      await consumeInterjections(
        fixture.ctx,
        fixture.rows('streams')[0] as never,
      ),
    ).toBe(false)
    fixture.agent.ownerId = 'another-agent-owner'
    const list = request.tools.list_skills.execute!
    expect(await list({}, {} as never)).toMatchObject({
      entries: [{ name: 'review' }],
    })
    fixture.folder.sources[0]!.discoverSkills = false
    expect(await list({}, {} as never)).toMatchObject({ entries: [] })
    fixture.rows('users')[0]!.role = 'user'
    await expect(list({}, {} as never)).rejects.toThrow('Forbidden')
    await expect(
      request.tools.read_file.execute!({ path: 'file' }, {} as never),
    ).rejects.toThrow('Forbidden')
    const shell = request.tools.shell.execute!(
      { command: 'pwd' },
      {} as never,
    ) as AsyncGenerator<unknown>
    await expect(shell.next()).rejects.toThrow('Forbidden')
  } finally {
    fixture.restore()
    await rm(root, { recursive: true, force: true })
  }
})

test('OpenAI and Anthropic wire requests retain the existing prefix after a skill update', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-prefix-'))
  const fixture = skillRequests(root)
  try {
    await writeSkill(root, 'Review code')
    const first = (await fixture.nextTurn())!
    await writeSkill(root, 'Review updated code')
    const second = (await fixture.nextTurn())!
    for (const provider of ['openai', 'anthropic']) {
      const a = await captureRequest(provider, first)
      const b = await captureRequest(provider, second)
      expect(b.tools).toEqual(a.tools)
      expect(b.system).toEqual(a.system)
      const key = provider === 'openai' ? 'input' : 'messages'
      expect(
        (b[key] as unknown[]).slice(0, (a[key] as unknown[]).length),
      ).toEqual(a[key] as unknown[])
    }
  } finally {
    fixture.restore()
    await rm(root, { recursive: true, force: true })
  }
})

test('folder renames, source changes, and personal-folder changes preserve the full provider prefix', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'workspace-prefix-'))
  const other = await mkdtemp(path.join(tmpdir(), 'workspace-prefix-'))
  const fixture = skillRequests(root)
  try {
    await writeSkill(root, 'Review original project')
    await writeSkill(other, 'Review moved project')
    let previous = (await fixture.nextTurn())!
    const initialCache = structuredClone(fixture.rows('sessionCache'))
    const originalNote = structuredClone(fixture.rows('messageContents')[2])
    expect(previous.systemPrompt).toBe('Frozen instructions')
    expect((previous.messages[1] as { content: string }).content).toContain(
      'Folder: "Repo"',
    )

    await rename({ ...fixture.ctx, userId: 'owner' } as never, {
      folderId: 'folder' as never,
      name: 'Renamed repo',
    })
    // Live configuration changes append notes at the next provider boundary.
    const renamed = (await fixture.repeat())!
    expect(renamed.messages.slice(0, previous.messages.length)).toEqual(
      previous.messages,
    )
    previous = renamed

    const transitions = [
      () => {}, // The pending rename is announced on the next logical invocation.
      () => {
        fixture.folder.sources[0]!.path = other
        fixture.folder.revision++
      },
      () => {
        fixture.agent.home = { path: '/fixture-personal-home', revision: 1 }
      },
      () => {
        fixture.agent.home = { path: '/fixture-moved-home', revision: 2 }
      },
      () => {
        fixture.agent.home = null
      },
      () => {
        fixture.folder.sources = []
        fixture.folder.revision++
      },
    ]
    for (const transition of transitions) {
      transition()
      const next = (await fixture.nextTurn())!
      expect(next.systemPrompt).toBe(previous.systemPrompt)
      expect(JSON.stringify(next.toolRuntime!.frozen.definitions)).toBe(
        JSON.stringify(previous.toolRuntime!.frozen.definitions),
      )
      expect(next.messages.slice(0, previous.messages.length)).toEqual(
        previous.messages,
      )
      for (const provider of ['openai', 'anthropic']) {
        const a = await captureRequest(provider, previous)
        const b = await captureRequest(provider, next)
        expect(b.tools).toEqual(a.tools)
        expect(b.system).toEqual(a.system)
        const key = provider === 'openai' ? 'input' : 'messages'
        expect(
          (b[key] as unknown[]).slice(0, (a[key] as unknown[]).length),
        ).toEqual(a[key] as unknown[])
      }
      previous = next
    }
    const cache = fixture.rows('sessionCache')[0]!
    expect(cache.tools).toEqual(initialCache[0]!.tools)
    expect(cache.items).toEqual(initialCache[0]!.items)
    expect(cache.historyPresentation).toEqual(
      initialCache[0]!.historyPresentation,
    )
    expect(fixture.rows('messageContents')[2]).toEqual(originalNote)
    expect(JSON.stringify(previous.messages)).toContain('Renamed repo')
    expect(JSON.stringify(previous.messages)).toContain('Re-read files')
    expect(JSON.stringify(previous.messages.at(-1))).toContain(
      'No skills are currently available',
    )
    await expect(
      previous.tools.read_file.execute!({ path: 'file' }, {} as never),
    ).rejects.toThrow('no longer enabled')
    await expect(
      previous.tools.shell.execute!({ command: 'pwd' }, {} as never),
    ).rejects.toThrow('no longer enabled')
  } finally {
    fixture.restore()
    await rm(root, { recursive: true, force: true })
    await rm(other, { recursive: true, force: true })
  }
})

test('tools captured with personal-folder guidance retain it after the home disappears', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'workspace-prefix-'))
  const fixture = skillRequests(root)
  try {
    fixture.agent.home = { path: '/fixture-personal-home', revision: 1 }
    const first = (await fixture.nextTurn())!
    expect(
      first.toolRuntime!.frozen.definitions!.find(
        (tool) => tool.name === 'read_file',
      )!.description,
    ).toContain('agent://')
    fixture.agent.home = null
    const second = (await fixture.nextTurn())!
    expect(second.toolRuntime!.frozen.definitions).toEqual(
      first.toolRuntime!.frozen.definitions,
    )
    expect(second.messages.slice(0, first.messages.length)).toEqual(
      first.messages,
    )
  } finally {
    fixture.restore()
    await rm(root, { recursive: true, force: true })
  }
})

test('agent presentation changes do not reformat previously introduced history', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'history-prefix-'))
  const fixture = skillRequests(root)
  try {
    const messageId = await fixture.db.insert('messages', {
      sessionId: 'session',
      role: 'assistant',
      sender: { type: 'agent', id: 'other-agent' },
      senderName: 'Other agent',
      status: 'done',
      contextEligible: true,
      selectedVersion: 1,
    })
    await fixture.db.insert('messageContents', {
      messageId,
      version: 1,
      segmentIndex: 0,
      parts: [{ type: 'text', text: 'A previous answer' }],
    })
    const first = (await fixture.nextTurn())!
    fixture.agent.maskOtherAgents = true
    fixture.agent.shareUserDisplayNames = true
    fixture.agent.shareAgentDisplayNames = true
    const second = (await fixture.nextTurn())!
    expect(second.messages.slice(0, first.messages.length)).toEqual(
      first.messages,
    )
    expect(second.messages[0].role).toBe('assistant')
    expect(JSON.stringify(second.messages)).not.toContain('Other agent:')
    expect(JSON.stringify(second.messages)).not.toContain('User:')
  } finally {
    fixture.restore()
    await rm(root, { recursive: true, force: true })
  }
})
