import { rename } from '@sb/convex/model/session/folders'
import { consumeInterjections } from '@sb/convex/model/stream/lifecycleProgress'
import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

const wireTools = (tools: Record<string, unknown>) =>
  JSON.stringify(tools, (key, value) => (key === 'execute' ? undefined : value))

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
    expect(wireTools(second.tools)).toBe(wireTools(first.tools))
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
    expect(
      fixture.rows('messages').filter((row) => row.type === 'skills'),
    ).toHaveLength(2)
    expect(third.messages.slice(0, second.messages.length)).toEqual(
      second.messages,
    )

    fixture.folder.sources[0]!.discoverSkills = false
    const fourth = (await fixture.nextTurn())!
    expect(fourth.systemPrompt).toBe(first.systemPrompt)
    expect(wireTools(fourth.tools)).toBe(wireTools(first.tools))
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
    // A provider retry never rewrites or adds context to a request already sent.
    expect((await fixture.repeat())!.messages).toEqual(previous.messages)

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
      expect(wireTools(next.tools)).toBe(wireTools(previous.tools))
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
    expect(fixture.rows('sessionCache')).toEqual(initialCache)
    expect(fixture.rows('messageContents')[2]).toEqual(originalNote)
    expect(JSON.stringify(previous.messages)).toContain('Renamed repo')
    expect(JSON.stringify(previous.messages)).toContain('Re-read files')
    expect(JSON.stringify(previous.messages.at(-1))).toContain(
      'No skills are currently available',
    )
    await expect(
      previous.tools.read_file.execute!({ path: 'file' }, {} as never),
    ).rejects.toThrow('No filesystem context')
    const shell = previous.tools.shell.execute!(
      { command: 'pwd' },
      {} as never,
    ) as AsyncGenerator<unknown>
    await expect(shell.next()).rejects.toThrow('No filesystem context')
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
    const cache = fixture.rows('sessionCache')[0]!
    cache.tools = { ...(cache.tools as object), hasAgentHome: true }
    const first = (await fixture.nextTurn())!
    expect(first.tools.read_file.description).toContain('agent://')
    fixture.agent.home = null
    const second = (await fixture.nextTurn())!
    expect(wireTools(second.tools)).toBe(wireTools(first.tools))
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
