import {
  guidanceSnapshot,
  mcpContextInstructions,
} from '@cv/convex/model/mcpCatalogContext'
import { catalogNote } from '@cv/convex/model/skills/runtime'
import { mcpToModelOutput } from '@cv/convex/model/tool/mcpOutput'
import { publish } from '@cv/convex/model/toolkits/publication'
import { mcpResult } from '@cv/core/types/mcp-result'
import { inspectToolkit } from '@cv/sidecar/toolkits/manifest'
import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { skillRequests } from '~/tests/helpers/skill-requests'

async function rootWithSkill() {
  const root = await mkdtemp(path.join(tmpdir(), 'tool-context-opt-in-'))
  await mkdir(path.join(root, '.agents/skills/review'), { recursive: true })
  await writeFile(
    path.join(root, '.agents/skills/review/SKILL.md'),
    '---\nname: review\ndescription: Review this project\n---\nInstructions',
  )
  return root
}

test('all built-ins off makes no capability sidecar requests and injects no workspace or skill context', async () => {
  const root = await rootWithSkill()
  const f = skillRequests(root)
  const fetch = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = (async (url, init) => {
    requests.push(String(url))
    return fetch(url, init)
  }) as typeof fetch
  try {
    f.agent.tools = []
    f.rows('sessionCache').splice(0)
    const request = (await f.nextTurn())!
    expect(request.toolRuntime!.current.names).toEqual([])
    expect(request.messages).toHaveLength(1)
    expect(requests.filter((url) => !url.endsWith('/eval/prompts'))).toEqual([])
    expect(request.toolRuntime!.frozen.names).toEqual(['get_tool', 'call_tool'])
    await expect(
      request.tools.get_tool.execute!({ name: 'read_file' }, {} as never),
    ).rejects.toThrow('disabled')
    expect(
      f
        .rows('messages')
        .filter((row) =>
          ['skills', 'workspace', 'mcp'].includes(String(row.type)),
        ),
    ).toHaveLength(0)
  } finally {
    f.restore()
    await rm(root, { recursive: true, force: true })
  }
})

test('reset removes automatic disabled-feature notes from provider history while retaining stored records', async () => {
  const root = await rootWithSkill()
  const f = skillRequests(root)
  try {
    await f.nextTurn()
    const notes = f
      .rows('messages')
      .filter((row) => ['skills', 'workspace'].includes(String(row.type)))
    expect(notes).toHaveLength(2)
    f.agent.tools = []
    const frozen = (await f.nextTurn())!
    expect(frozen.tools.read_file).toBeDefined()
    expect(JSON.stringify(frozen.messages)).toContain('Review this project')
    f.rows('sessionCache').splice(0)
    const reset = (await f.nextTurn())!
    expect(reset.toolRuntime!.current.names).toEqual([])
    expect(JSON.stringify(reset.messages)).not.toContain('Review this project')
    expect(JSON.stringify(reset.messages)).not.toContain('Primary source')
    expect(
      f
        .rows('messages')
        .filter((row) => notes.some((note) => note._id === row._id)),
    ).toEqual(notes)
  } finally {
    f.restore()
    await rm(root, { recursive: true, force: true })
  }
})

test('project skills can be read with Skills alone while their source is enabled', async () => {
  const root = await rootWithSkill()
  const f = skillRequests(root)
  try {
    f.rows('sessionCache').splice(0)
    f.agent.tools = ['skills']
    const request = (await f.nextTurn())!
    expect(request.toolRuntime!.current.names).toEqual([
      'list_skills',
      'read_skill',
    ])
    const text = JSON.stringify(request.messages)
    expect(text).toContain('Review this project')
    expect(text).not.toContain('Use read_file')
    expect(text).toContain('review@project:root')
    expect(
      await request.tools.list_skills.execute!({}, {} as never),
    ).toMatchObject({
      entries: [{ name: 'review', skill_id: 'review@project:root' }],
    })
    expect(
      f.rows('messages').filter((row) => row.type === 'workspace'),
    ).toHaveLength(0)
    const note = f.rows('messages').find((row) => row.type === 'skills')!
    expect(note.extra).toMatchObject({
      capabilities: ['list_skills', 'read_skill'],
    })
    const read = (skill_id: string, resource?: string) =>
      request.tools.read_skill.execute!(
        { skill_id, resource, offset: 0, length: 500 },
        {} as never,
      )
    expect(await read('review')).toMatchObject({
      content: expect.stringContaining('Instructions'),
      origin: 'project',
    })
    await expect(
      read('review@project:root', '../../../outside'),
    ).rejects.toThrow('inside this skill')
    f.folder.sources[0]!.discoverSkills = false
    await expect(read('review@project:root')).rejects.toThrow(
      'Project skill unavailable',
    )
  } finally {
    f.restore()
    await rm(root, { recursive: true, force: true })
  }
})

test('an empty skill directory exposes no skill tools or automatic catalog', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'empty-skills-'))
  const f = skillRequests(root)
  try {
    f.rows('sessionCache').splice(0)
    f.agent.tools = ['skills']
    const request = (await f.nextTurn())!
    expect(request.toolRuntime!.current.names).toEqual([])
    expect(
      f.rows('messages').filter((row) => row.type === 'skills'),
    ).toHaveLength(0)
  } finally {
    f.restore()
    await rm(root, { recursive: true, force: true })
  }
})

test('generated guidance and incomplete previews reference only available helpers', () => {
  const direct = mcpContextInstructions('{}', ['docs_work'])
  for (const tool of ['mcp_protocol', 'search_mcp_tools', 'call_mcp_tool'])
    expect(direct).not.toContain(tool)
  expect(
    guidanceSnapshot([{ server: 'Docs', initialization: 'data' }], false)[0],
  ).not.toHaveProperty('fullGuidance')
  const page = {
    entries: [
      { name: 'review', description: 'Review', path: '/root/SKILL.md' },
    ],
    fingerprint: 'a',
    cursor: null,
    isDone: true,
  }
  expect(catalogNote(page, ['list_skills'])).not.toContain('read_file')
  expect(catalogNote(page, ['list_skills'])).not.toContain('read_skill')
  const output = mcpResult(
    { content: [{ type: 'text', text: 'x'.repeat(40_000) }] },
    { serverId: 'server', name: 'work' },
  )
  expect(
    JSON.stringify(mcpToModelOutput({ output }, false, false)),
  ).not.toContain('read_mcp_output')
  expect(JSON.stringify(mcpToModelOutput({ output }, false, true))).toContain(
    'read_mcp_output',
  )
})

test('a linked skills-only toolkit exposes its reader through Skills without file or MCP tools', async () => {
  const root = await rootWithSkill()
  const f = skillRequests(root)
  try {
    await writeFile(path.join(root, '.agents/toolkit.json'), '{}')
    await f.db.patch('owner', { subject: 'owner' })
    const snapshot = await inspectToolkit(root)
    const toolkitId = await publish(f.ctx, {
      subject: 'owner',
      root,
      revision: snapshot.revision,
      manifest: JSON.stringify(snapshot.manifest),
      connections: [],
    })
    Object.assign(f.agent, { toolkitIds: [toolkitId] })
    f.folder.sources[0]!.discoverSkills = false
    f.rows('sessionCache').splice(0)
    f.agent.tools = []
    expect((await f.nextTurn())!.toolRuntime!.current.names).toEqual([])
    f.rows('sessionCache').splice(0)
    f.agent.tools = ['skills']
    const request = (await f.nextTurn())!
    expect(request.toolRuntime!.current.names).toEqual([
      'list_skills',
      'read_skill',
    ])
    expect(JSON.stringify(request.messages)).toContain(
      `review@toolkit:${toolkitId}`,
    )
    expect(
      await request.tools.read_skill.execute!(
        {
          skill_id: `review@toolkit:${toolkitId}`,
          offset: 0,
          length: 500,
        },
        {} as never,
      ),
    ).toMatchObject({ origin: 'toolkit' })
    expect(JSON.stringify(request.messages)).not.toContain('Use read_file')
    expect(
      f.rows('messages').filter((row) => row.type === 'workspace'),
    ).toHaveLength(0)
    const project = path.join(root, 'other-project')
    const skill = path.join(project, '.agents/skills/review')
    await mkdir(skill, { recursive: true })
    await writeFile(
      path.join(skill, 'SKILL.md'),
      '---\nname: review\ndescription: Project review\n---\nProject instructions',
    )
    await writeFile(path.join(skill, 'details.txt'), 'Project details')
    f.folder.sources.push({
      id: 'other',
      path: project,
      label: 'Other project',
      discoverSkills: true,
    })
    const read = (skill_id: string, resource?: string) =>
      request.tools.read_skill.execute!(
        { skill_id, resource, offset: 0, length: 500 },
        {} as never,
      )
    await expect(read('review')).rejects.toThrow('More than one skill is named')
    expect(await read(`review@toolkit:${toolkitId}`)).toMatchObject({
      origin: 'toolkit',
    })
    expect(await read('review@project:other', 'details.txt')).toMatchObject({
      content: 'Project details',
      origin: 'project',
    })
  } finally {
    f.restore()
    await rm(root, { recursive: true, force: true })
  }
})
