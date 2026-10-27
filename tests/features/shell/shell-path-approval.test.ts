import { withApprovalPaths } from '@sb/convex/actions/stream/engineApproval'
import { analyzeShellPathCandidates } from '@sb/convex/lib/tool/approval'
import type { WorkspaceToolContext } from '@sb/convex/model/tool/context'
import { createShellTool } from '@sb/convex/model/tool/shellTools'
import { checkPaths } from '@sb/sidecar/mcp/workspace/check-paths'
import { checkScopedPaths } from '@sb/sidecar/mcp/workspace/scoped-checks'
import type { UIMessage } from 'ai'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { REPORTED_APPROVAL_COMMANDS } from '~/tests/helpers/approval-commands'

let base: string
let root: string
let external: string
let context: WorkspaceToolContext
let server: ReturnType<typeof Bun.serve>
let previousUrl: string | undefined
const previousDataEnvironment: Record<string, string | undefined> = {}
let available = true

async function createFixture() {
  base = await mkdtemp(path.join(tmpdir(), 'shell-path-approval-'))
  root = path.join(base, 'workspace')
  external = path.join(base, 'external')
  for (const directory of [
    'src/server',
    'src/main',
    'src/composition',
    'ignored',
  ]) {
    await mkdir(path.join(root, directory), { recursive: true })
  }
  await mkdir(external)
  expect(Bun.spawnSync(['git', 'init', '-q', root]).exitCode).toBe(0)
  for (const file of [
    'README.md',
    'src/main.ts',
    'src/server/createServer.ts',
    'ignored/patterns.txt',
    '50',
    'auto',
    '-notes',
  ]) {
    await writeFile(path.join(root, file), 'fixture')
  }
  await writeFile(path.join(root, '.gitignore'), 'ignored/\n50\nauto\n-notes\n')
  await writeFile(path.join(external, 'file.txt'), 'outside')
  await symlink(external, path.join(root, 'src/escape'))
  await symlink(path.join(external, 'missing'), path.join(root, 'dangling'))
  context = {
    sessionId: 'shell-paths',
    ownerId: 'shell-paths',
    workspaceId: 'shell-paths',
    workspace: {
      workspaceId: 'shell-paths',
      path: root,
      label: 'Fixture',
      sources: [{ id: 'primary', path: root, label: 'Fixture' }],
    },
  } as WorkspaceToolContext
}

async function needsApproval(command: string, cwd?: string, paths?: string[]) {
  const tool = await createShellTool({
    ...context,
    approvals: async () => ({ paths }),
  })
  const predicate = tool.needsApproval as (input: {
    command: string
    cwd?: string
  }) => Promise<boolean>
  return predicate({ command, cwd })
}

async function approvalPreview(command: string) {
  return withApprovalPaths(context, {
    type: 'tool-shell',
    toolCallId: 'shell-paths',
    state: 'approval-requested',
    input: { command },
    approval: { id: 'shell-paths' },
  } as UIMessage['parts'][number])
}

describe('shell approval through scoped MCP path checks', () => {
  beforeAll(async () => {
    await createFixture()
    const dataEnvironment = {
      CHAT_SIDECAR_DATA_DIR: path.join(base, 'data'),
      CHAT_WORKSPACE_STORE: path.join(base, 'data/workspaces.json'),
      CHAT_WORKSPACE_CHECKPOINTS: path.join(base, 'data/checkpoints'),
    }
    for (const [key, value] of Object.entries(dataEnvironment)) {
      previousDataEnvironment[key] = process.env[key]
      process.env[key] = value
    }
    const { handleMcpRequest } = await import('@sb/sidecar/mcp/mcp')
    const app = new Hono().all('/mcp', (c) =>
      available ? handleMcpRequest(c) : c.text('Unavailable', 503),
    )
    server = Bun.serve({ port: 0, fetch: app.fetch })
    previousUrl = process.env.SIDECAR_URL
    process.env.SIDECAR_URL = `http://localhost:${server.port}`
  })
  afterAll(async () => {
    server?.stop(true)
    if (previousUrl === undefined) delete process.env.SIDECAR_URL
    else process.env.SIDECAR_URL = previousUrl
    for (const [key, value] of Object.entries(previousDataEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(base, { recursive: true, force: true })
  })

  test.each(REPORTED_APPROVAL_COMMANDS)(
    'auto-approves reported command: $command',
    async ({ command }) => {
      expect(await needsApproval(command)).toBe(false)
      expect(await approvalPreview(command)).toMatchObject({
        approvalPathStatus: null,
      })
    },
  )

  test.each([
    'ls -la',
    'head -n 50 README.md',
    'ls --color=auto src',
    'ls -I auto src',
    'grep -eauto README.md',
    'rg --files-with-matches auto src',
  ])(
    'auto-approves safe reads without treating option data as ignored files: %s',
    async (command) => {
      expect(await needsApproval(command)).toBe(false)
    },
  )

  test.each([
    'head -n 50 ignored/patterns.txt',
    'ls --color=auto ignored',
    'grep -ifignored/patterns.txt README.md',
    'grep -if ignored/patterns.txt README.md',
    'rg --files-with-matches needle ignored',
    'rg --ignore-file ignored/patterns.txt needle src',
    'cat .git/config',
    'head -- -notes',
    'ls -- -notes',
    'grep -- needle -notes',
    'head -n',
    'grep -if',
    'rg --pre=custom needle src',
    'cat src/escape/file.txt',
    'cat dangling',
    'echo $(pwd)',
    'ls > output.txt',
  ])('retains approval requirements: %s', async (command) => {
    expect(await needsApproval(command)).toBe(true)
  })

  test('external operands still require a grant', async () => {
    const command = `head -n 50 ${external}/file.txt`
    expect(await needsApproval(command)).toBe(true)
    expect(await needsApproval(command, undefined, [external])).toBe(false)
  })

  test('uses the actual cwd and respects ignored and external directories', async () => {
    for (const cwd of [
      'workspace://',
      root,
      `${root}/src/..`,
      'workspace://src',
    ]) {
      expect(await needsApproval('ls', cwd)).toBe(false)
    }
    expect(await needsApproval('ls', 'workspace://ignored')).toBe(true)
    expect(await needsApproval('ls', external)).toBe(true)
    expect(await needsApproval('ls', external, [external])).toBe(false)
  })

  test('supports a secondary source as the working directory', async () => {
    const workspace = {
      ...context.workspace!,
      sources: [
        ...context.workspace!.sources!,
        { id: 'secondary', path: external, label: 'Secondary' },
      ],
    }
    const result = await checkScopedPaths({
      ...context,
      workspace,
      paths: ['file.txt'],
      cwd: external,
    })
    expect(result.complete).toBe(true)
    expect(result.uncovered).toEqual([])
  })

  test('retains useful protected-path explanations after root checks succeed', async () => {
    expect(await approvalPreview('cat .git/config')).toMatchObject({
      approvalPathStatus: 'forbidden',
    })
    expect(
      await approvalPreview('head -n 50 ignored/patterns.txt'),
    ).toMatchObject({
      approvalPathStatus: 'paths',
      approvalPaths: [path.join(root, 'ignored/patterns.txt')],
    })
  })

  test('fails closed for unexpected Git errors', async () => {
    const broken = path.join(base, 'broken')
    await mkdir(broken)
    expect(Bun.spawnSync(['git', 'init', '-q', broken]).exitCode).toBe(0)
    await writeFile(path.join(broken, '.git/config'), 'invalid config')
    expect((await checkPaths(broken, { paths: ['.'] })).complete).toBe(false)
  })

  test('sidecar failures require approval and retain the analysis warning', async () => {
    available = false
    try {
      expect(await needsApproval('ls')).toBe(true)
      expect(await approvalPreview('ls')).toMatchObject({
        approvalPathStatus: 'analysis',
      })
    } finally {
      available = true
    }
  })

  test('exact file candidates still reach scoped checks', async () => {
    const { candidates } = analyzeShellPathCandidates(
      'grep -if ignored/patterns.txt README.md',
    )
    const result = await checkScopedPaths({
      ...context,
      paths: candidates,
      cwd: 'workspace://',
    })
    expect(result.complete).toBe(true)
    expect(result.uncovered).toEqual([path.join(root, 'ignored/patterns.txt')])
  })
})
