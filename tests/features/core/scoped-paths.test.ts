import type { WorkspaceToolContext } from '@sb/convex/model/tool/context'
import { withAgentHome } from '@sb/core/workspace/personal'
import {
  createFileExistsHelper,
  createFileHelper,
} from '@sb/sidecar/eval/file-helper'
import type { createApp } from '@sb/sidecar/main'
import type * as WorkspaceFiles from '@sb/sidecar/mcp/workspace/workspace'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

let root: string
let project: string
let home: string
let outside: string
let files: typeof WorkspaceFiles
let app: ReturnType<typeof createApp>
const previous = {
  data: process.env.CHAT_SIDECAR_DATA_DIR,
  mode: process.env.CHAT_JOB_MODE,
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'scoped-paths-'))
  project = path.join(root, 'project')
  home = path.join(root, 'home')
  outside = path.join(root, 'outside')
  for (const dir of [
    project,
    home,
    outside,
    path.join(project, 'sub'),
    path.join(home, 'skills/review'),
    path.join(project, '.git'),
  ])
    await mkdir(dir, { recursive: true })
  await writeFile(path.join(project, 'note'), 'project note')
  await writeFile(path.join(home, 'note'), 'personal note')
  await writeFile(path.join(outside, 'note'), 'external note')
  await writeFile(path.join(home, 'skills/review/SKILL.md'), 'instructions')
  await writeFile(path.join(home, 'literal%20?#'), 'literal name')
  process.env.CHAT_SIDECAR_DATA_DIR = path.join(root, 'data')
  process.env.CHAT_JOB_MODE = 'pipe'
  files = await import('@sb/sidecar/mcp/workspace/workspace')
  const { createApp } = await import('@sb/sidecar/main')
  app = createApp(async (_c, next) => next())
})

afterAll(async () => {
  for (const [key, value] of [
    ['CHAT_SIDECAR_DATA_DIR', previous.data],
    ['CHAT_JOB_MODE', previous.mode],
  ]) {
    if (value === undefined) delete process.env[key!]
    else process.env[key!] = value
  }
  await rm(root, { recursive: true, force: true })
})

function context(sessionId = 'scoped') {
  return {
    sessionId,
    workspaceId: 'project',
    workspace: withAgentHome(
      {
        workspaceId: 'project',
        path: project,
        label: 'Project',
        sources: [{ id: 'p', path: project, label: 'Project' }],
      },
      {
        agentId: 'agent',
        homeId: 'home',
        ownerId: 'owner',
        path: home,
        revision: 0,
      },
    ),
  }
}

async function request(url: string, body: unknown) {
  return app.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('file tools and prompt helpers share prefixed paths without URL decoding', async () => {
  const input = context()
  expect(
    await files.readWorkspaceFile({ ...input, filePath: 'workspace://note' }),
  ).toMatchObject({ path: 'workspace://note', content: 'project note' })
  expect(
    await files.readWorkspaceFile({ ...input, filePath: 'agent://note' }),
  ).toMatchObject({ path: 'agent://note', content: 'personal note' })
  expect(
    (
      await files.readWorkspaceFile({
        ...input,
        filePath: 'agent://literal%20?#',
      })
    ).content,
  ).toBe('literal name')
  const read = createFileHelper(project, [project, outside], home)
  const exists = createFileExistsHelper(project, [project, outside], home)
  expect(read('agent://note', { wrap: false })).toBe('personal note')
  expect(read('workspace://note')).toContain('path="workspace://note"')
  expect(read(path.join(outside, 'note'), { wrap: false })).toBe(
    'external note',
  )
  expect(exists('agent://skills/review/SKILL.md')).toBe(true)
  expect(exists('agent://missing')).toBe(false)
  expect(() => exists('http://notes')).toThrow('filesystem prefix')
  expect(() => read(path.join(home, 'note'))).toThrow()
})

test('writes, previews, edits and checkpoint restoration retain the agent prefix', async () => {
  const input = { ...context('checkpoint'), filePath: 'agent://draft' }
  expect(
    await files.previewWorkspaceDiff({ ...input, content: 'draft one' }),
  ).toMatchObject({ path: 'agent://draft' })
  expect(
    await files.writeWorkspaceFile({ ...input, content: 'draft one' }),
  ).toMatchObject({ path: 'agent://draft' })
  expect(
    await files.editWorkspaceFile({
      ...input,
      edits: [{ oldText: 'one', newText: 'two' }],
    }),
  ).toMatchObject({ path: 'agent://draft' })
  expect(await readFile(path.join(home, 'draft'), 'utf8')).toBe('draft two')
  expect(
    await files.restoreLatestCheckpoint(context('checkpoint')),
  ).toMatchObject({ restored: 'agent://draft' })
  expect(await readFile(path.join(home, 'draft'), 'utf8')).toBe('draft one')
})

test('prefixes cannot escape through traversal or symlinks even with an external grant', async () => {
  await symlink(outside, path.join(home, 'escape'))
  await symlink(outside, path.join(project, 'escape'))
  for (const filePath of [
    'agent://../outside/note',
    'agent://escape/note',
    'workspace://escape/note',
  ]) {
    await expect(
      files.readWorkspaceFile({
        ...context(),
        filePath,
        allowedPaths: [outside],
      }),
    ).rejects.toThrow()
    await expect(
      files.checkFlaggedPaths({
        ...context(),
        paths: [filePath],
        literal: true,
        allowedPaths: [outside],
      }),
    ).rejects.toThrow()
    expect(() =>
      createFileHelper(project, [project, outside], home)(filePath),
    ).toThrow()
  }
  await expect(
    files.readWorkspaceFile({
      ...context(),
      filePath: path.join(outside, 'note'),
    }),
  ).rejects.toThrow('approval')
  expect(
    (
      await files.readWorkspaceFile({
        ...context(),
        filePath: path.join(outside, 'note'),
        allowedPaths: [outside],
      })
    ).content,
  ).toBe('external note')
})

test('approval paths use cwd, include cwd itself, and preserve the original grant base', async () => {
  const input = context()
  const local = await files.checkFlaggedPaths({
    ...input,
    cwd: 'workspace://sub',
    paths: ['../note'],
  })
  expect(local.complete).toBe(true)
  expect(local.resolved.map((item) => item.absolutePath)).toEqual([
    path.join(project, 'sub'),
    path.join(project, 'note'),
  ])
  const external = await files.checkFlaggedPaths({
    ...input,
    cwd: outside,
    paths: [],
  })
  expect(external.uncovered).toContain(outside)
  const allowed = await files.checkFlaggedPaths({
    ...input,
    cwd: outside,
    paths: ['note'],
    allowedPaths: ['../outside'],
  })
  expect(allowed.complete).toBe(true)
  expect(allowed.uncovered).toEqual([])
  const protectedCwd = await files.checkFlaggedPaths({
    ...input,
    cwd: 'workspace://.git',
    paths: [],
  })
  expect(protectedCwd.uncovered).toContain(path.join(project, '.git'))
  const personal = await files.checkFlaggedPaths({
    ...input,
    paths: ['agent://note'],
    literal: true,
  })
  expect(personal.resolved[0]?.path).toBe('agent://note')
})

test('shell start rejects stale scope, unavailable roots and unapproved external directories', async () => {
  for (const extra of [
    { scope: 'agent' },
    { cwd: outside },
    { cwd: 'workspace://note' },
    { cwd: 'agent://escape' },
  ]) {
    const response = await request('/shell/start', {
      ...context(),
      command: 'pwd',
      ...extra,
    })
    expect(response.ok).toBe(false)
  }
  const input = context()
  const personalOnly = {
    ...input,
    workspaceId: 'agent:agent',
    workspace: withAgentHome(undefined, input.workspace.agentHome!),
  }
  expect(
    (await request('/shell/start', { ...personalOnly, command: 'pwd' })).ok,
  ).toBe(false)
  const noHome = {
    ...input,
    workspace: { ...input.workspace, agentHome: undefined },
  }
  expect(
    (
      await request('/shell/start', {
        ...noHome,
        cwd: 'agent://',
        command: 'pwd',
      })
    ).ok,
  ).toBe(false)
})

async function shellOutput(body: Record<string, unknown>) {
  const response = await request('/shell/start', {
    ...context(),
    command: 'pwd',
    ...body,
  })
  expect(response.ok).toBe(true)
  const { jobId } = (await response.json()) as { jobId: string }
  const { pollShellJob } = await import('@sb/sidecar/shell/registry')
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = pollShellJob(jobId, 'scoped', 0)
    if (result.status !== 'running') return result.chunk.replaceAll('\r', '')
    await Bun.sleep(25)
  }
  throw new Error('Shell did not finish')
}

test('every shell mode receives resolved cwd and authoritative root variables', async () => {
  const oldAgent = process.env.AGENT_DIR
  const oldWorkspace = process.env.WORKSPACE_DIR
  process.env.AGENT_DIR = 'stale-agent'
  process.env.WORKSPACE_DIR = 'stale-workspace'
  try {
    for (const mode of ['pipe', 'script', 'pty']) {
      process.env.CHAT_JOB_MODE = mode
      const output = await shellOutput({
        cwd: 'agent://skills/review',
        command:
          'printf "%s\\n" "$PWD" "$AGENT_DIR" "$WORKSPACE_DIR" "agent://note"',
      })
      expect(output).toBe(
        `${home}/skills/review\n${home}\n${project}\nagent://note\n`,
      )
    }
    const input = context()
    const output = await shellOutput({
      workspace: { ...input.workspace, agentHome: undefined },
      command: 'printf "%s|%s" "${AGENT_DIR-unset}" "$WORKSPACE_DIR"',
    })
    expect(output.trim()).toBe(`unset|${project}`)
    const personalOnly = await shellOutput({
      workspaceId: 'agent:agent',
      workspace: withAgentHome(undefined, input.workspace.agentHome!),
      cwd: 'agent://',
      command: 'printf "%s|%s" "$AGENT_DIR" "${WORKSPACE_DIR-unset}"',
    })
    expect(personalOnly.trim()).toBe(`${home}|unset`)
  } finally {
    if (oldAgent === undefined) delete process.env.AGENT_DIR
    else process.env.AGENT_DIR = oldAgent
    if (oldWorkspace === undefined) delete process.env.WORKSPACE_DIR
    else process.env.WORKSPACE_DIR = oldWorkspace
  }
})

test('parent and subagent calls resolve their own folders without leaking authority', async () => {
  const child = path.join(root, 'child')
  await mkdir(child)
  await writeFile(path.join(child, 'note'), 'child note')
  const input = context()
  const childContext = {
    ...input,
    sessionId: 'child-session',
    workspace: withAgentHome(input.workspace, {
      ownerId: 'owner',
      agentId: 'child',
      path: child,
      revision: 0,
    }),
  }
  expect(
    (
      await files.readWorkspaceFile({
        ...childContext,
        filePath: 'agent://note',
      })
    ).content,
  ).toBe('child note')
  expect(
    (await files.readWorkspaceFile({ ...input, filePath: 'agent://note' }))
      .content,
  ).toBe('personal note')
  await expect(
    files.readWorkspaceFile({
      ...childContext,
      filePath: 'agent://../home/note',
    }),
  ).rejects.toThrow()
})

test('real MCP tools agree with execution for prefixed files and external cwd approvals', async () => {
  const server = Bun.serve({ port: 0, fetch: (request) => app.fetch(request) })
  const url = process.env.SIDECAR_URL
  const secret = process.env.SIDECAR_SECRET
  process.env.SIDECAR_URL = `http://127.0.0.1:${server.port}`
  process.env.SIDECAR_SECRET = 'test-secret'
  try {
    const { createShellTool } = await import('@sb/convex/model/tool/shellTools')
    const { createReadFileTool, createWriteFileTool } =
      await import('@sb/convex/model/tool/files')
    const input = {
      ...context(),
      ownerId: 'scoped',
      approvals: async () => ({ tools: ['write_file'] }),
    } as unknown as WorkspaceToolContext
    const needs = (tool: unknown, args: unknown) =>
      (
        tool as { needsApproval: (input: unknown) => Promise<boolean> }
      ).needsApproval(args)
    const read = await createReadFileTool(input)
    expect(await needs(read, { path: 'agent://note' })).toBe(false)
    const output = await read.execute!(
      { path: 'agent://note' },
      { toolCallId: 'read', messages: [], context: undefined as never },
    )
    expect(JSON.parse(output as string)).toMatchObject({
      path: 'agent://note',
      content: 'personal note',
    })
    const write = await createWriteFileTool(input)
    expect(await needs(write, { path: 'agent://new', content: 'new' })).toBe(
      false,
    )
    const written = await write.execute!(
      { path: 'agent://new', content: 'new' },
      { toolCallId: 'write', messages: [], context: undefined as never },
    )
    expect(JSON.parse(written as string)).toMatchObject({ path: 'agent://new' })
    const shell = await createShellTool(input)
    expect(await needs(shell, { command: 'pwd', cwd: outside })).toBe(true)
    expect(await needs(shell, { command: 'pwd', cwd: 'workspace://sub' })).toBe(
      false,
    )
    expect(
      await needs(shell, { command: 'pwd', cwd: 'workspace://.git' }),
    ).toBe(true)
    // This execute call models a once-approved request, without saving a path grant.
    const result = shell.execute!(
      { command: 'pwd', cwd: outside },
      { toolCallId: 'shell', messages: [], context: undefined as never },
    ) as AsyncIterable<{ text: string }>
    let text = ''
    for await (const output of result) text += output.text
    expect(text).toContain(outside)
  } finally {
    server.stop(true)
    if (url === undefined) delete process.env.SIDECAR_URL
    else process.env.SIDECAR_URL = url
    if (secret === undefined) delete process.env.SIDECAR_SECRET
    else process.env.SIDECAR_SECRET = secret
  }
})
