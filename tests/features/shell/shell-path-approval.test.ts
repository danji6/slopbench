import { withApprovalPaths } from '@cv/convex/actions/stream/engineApproval'
import { analyzeShellPathCandidates } from '@cv/convex/lib/tool/approval'
import type { WorkspaceToolContext } from '@cv/convex/model/tool/context'
import { createShellTool } from '@cv/convex/model/tool/shellTools'
import { checkPaths } from '@cv/sidecar/mcp/workspace/check-paths'
import { checkScopedPaths } from '@cv/sidecar/mcp/workspace/scoped-checks'
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
    'tests/browser',
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
    'format',
    'test',
    'tests/browser/excluded.test.ts',
  ]) {
    await writeFile(path.join(root, file), 'fixture')
  }
  await writeFile(
    path.join(root, '.gitignore'),
    'ignored/\n50\nauto\n-notes\nformat\ntest\ntests/browser/\n',
  )
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

type ApprovalOptions = {
  cwd?: string
  paths?: string[]
  shell?: string[]
  plan?: boolean
}

async function needsApproval(command: string, options: ApprovalOptions = {}) {
  const { cwd, paths, shell, plan = false } = options
  const tool = await createShellTool({
    ...context,
    approvals: async () => ({ paths, shell }),
    isPlanMode: async () => plan,
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
    }
    for (const [key, value] of Object.entries(dataEnvironment)) {
      previousDataEnvironment[key] = process.env[key]
      process.env[key] = value
    }
    const { handleMcpRequest } = await import('@cv/sidecar/mcp/mcp')
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

  test('honors Bun task grants for the reported formatting and test chain', async () => {
    const command =
      "bun format packages/client/src/components/chat/widgets/mode-widget.tsx tests/features/runtime/mode-widget.test.tsx && bun test --isolate --path-ignore-patterns '**/browser/**' ./tests/features/runtime/mode-widget.test.tsx"
    expect(await needsApproval(command)).toBe(true)
    expect(await needsApproval(command, { shell: ['bun test'] })).toBe(true)
    const shell = ['bun format', 'bun test']
    expect(await needsApproval(command, { shell })).toBe(false)
    expect(await needsApproval(command, { shell, plan: true })).toBe(true)
    expect(await approvalPreview(command)).toMatchObject({
      approvalPathStatus: null,
    })
  })

  test('Bun runner prefixes retain path and plan approval gates', async () => {
    const shell = ['bun run']
    const command = 'bun run tests README.md'
    expect(await needsApproval(command, { shell })).toBe(false)
    expect(await needsApproval(command, { shell, plan: true })).toBe(true)
    expect(
      await needsApproval('bun run tests ignored/patterns.txt', { shell }),
    ).toBe(true)
    expect(await needsApproval('bun run --cwd ignored tests', { shell })).toBe(
      true,
    )
  })

  test.each([
    'bun test --preload ignored/patterns.txt README.md',
    'bun test --reporter junit --reporter-outfile .git/report.xml',
    'bun --cwd ignored test',
    'bun test --unknown=README.md',
    'bun test --preload',
    'bun format ignored/patterns.txt',
    'bun test README.md > output.txt',
  ])('Bun grants retain path and syntax checks: %s', async (command) => {
    expect(
      await needsApproval(command, { shell: ['bun test', 'bun format'] }),
    ).toBe(true)
  })

  test.each([
    ['npm run test -- README.md', 'npm run test'],
    ['pnpm exec eslint README.md', 'pnpm exec eslint'],
    ['uv run --with pytest pytest README.md', 'uv run pytest'],
    ['uv tool run pytest README.md', 'uv tool run pytest'],
  ])(
    'honors saved runner grants through scoped checks: %s',
    async (command, pattern) => {
      expect(await needsApproval(command)).toBe(true)
      expect(await needsApproval(command, { shell: [pattern] })).toBe(false)
      expect(
        await needsApproval(command, { shell: [pattern], plan: true }),
      ).toBe(true)
      expect(await approvalPreview(command)).toMatchObject({
        approvalPathStatus: null,
      })
    },
  )

  test.each([
    ['npm run test -- ignored/patterns.txt', 'npm run test'],
    ['npm run test -- -- -notes', 'npm run test'],
    ['pnpm --filter "*" run test', 'pnpm run test'],
    [
      'npx --userconfig ignored/patterns.txt prettier README.md',
      'npx prettier',
    ],
    [
      'uv run --with-requirements ignored/patterns.txt pytest README.md',
      'uv run pytest',
    ],
    ['uv run python "ignored/patterns.txt"', 'uv run python'],
    ['uv run grep -f.git/config README.md', 'uv run grep'],
    ['uvx --from ./ignored pytest README.md', 'uvx pytest'],
    ['uv run cat src/escape/file.txt', 'uv run cat'],
    ['uv run --directory src pytest ../ignored/patterns.txt', 'uv run pytest'],
  ])(
    'runner grants retain protected-path and selection checks: %s',
    async (command, pattern) => {
      expect(await needsApproval(command, { shell: [pattern] })).toBe(true)
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
    expect(await needsApproval(command, { paths: [external] })).toBe(false)
  })

  test('uses the actual cwd and respects ignored and external directories', async () => {
    for (const cwd of [
      'workspace://',
      root,
      `${root}/src/..`,
      'workspace://src',
    ]) {
      expect(await needsApproval('ls', { cwd })).toBe(false)
    }
    expect(await needsApproval('ls', { cwd: 'workspace://ignored' })).toBe(true)
    expect(await needsApproval('ls', { cwd: external })).toBe(true)
    expect(
      await needsApproval('ls', { cwd: external, paths: [external] }),
    ).toBe(false)
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
