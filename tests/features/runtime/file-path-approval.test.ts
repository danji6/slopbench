import { buildApprovalActions } from '@/lib/chat/tool-approval-policy'
import { attachApprovalPreviews } from '@sb/convex/actions/stream/engineApproval'
import { alwaysLabel, approvalHold } from '@sb/convex/lib/tool/approvalPolicy'
import { rememberApproval } from '@sb/convex/model/chat/approvalMemory'
import { patchToolApproval } from '@sb/convex/model/chat/approvals'
import { getSessionWithWorkspace } from '@sb/convex/model/session/folderContext'
import { getApprovals } from '@sb/convex/model/session/state'
import type { WorkspaceToolContext } from '@sb/convex/model/tool/context'
import {
  createEditFileTool,
  createReadFileTool,
  createWriteFileTool,
} from '@sb/convex/model/tool/files'
import { callMcpTool } from '@sb/convex/model/tool/mcp'
import type { ToolApprovals } from '@sb/core/types'
import { withAgentHome } from '@sb/core/workspace/personal'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Hono } from 'hono'
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
import type { ZodType } from 'zod'
import { skillsDatabase } from '~/tests/helpers/skills-db'

let root: string
let project: string
let outside: string
let server: ReturnType<typeof Bun.serve>
let context: WorkspaceToolContext
let approvals: ToolApprovals = {}
const previousUrl = process.env.SIDECAR_URL
const previousData = process.env.CHAT_SIDECAR_DATA_DIR
const options = { toolCallId: 'approved-file', messages: [], context: undefined as never } // prettier-ignore

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'file-path-approval-'))
  project = path.join(root, 'project')
  outside = path.join(root, 'outside')
  await mkdir(project)
  await mkdir(outside)
  await writeFile(path.join(outside, 'note'), 'external note')
  await symlink(outside, path.join(project, 'external'))
  process.env.CHAT_SIDECAR_DATA_DIR = path.join(root, 'data')
  const { handleMcpRequest } = await import('@sb/sidecar/mcp/mcp')
  const app = new Hono().all('/mcp', handleMcpRequest)
  server = Bun.serve({ port: 0, fetch: (request) => app.fetch(request) })
  process.env.SIDECAR_URL = `http://127.0.0.1:${server.port}`
  context = {
    sessionId: 'approved-file-session',
    ownerId: 'approved-file-session',
    workspaceId: 'project',
    workspace: {
      workspaceId: 'project',
      path: project,
      label: 'Project',
      sources: [{ id: 'project', path: project, label: 'Project' }],
    },
    approvals: async () => approvals,
  } as WorkspaceToolContext
})

afterAll(async () => {
  server?.stop(true)
  if (previousUrl === undefined) delete process.env.SIDECAR_URL
  else process.env.SIDECAR_URL = previousUrl
  if (previousData === undefined) delete process.env.CHAT_SIDECAR_DATA_DIR
  else process.env.CHAT_SIDECAR_DATA_DIR = previousData
  await rm(root, { recursive: true, force: true })
})

async function needsApproval(tool: unknown, input: unknown) {
  return (
    tool as { needsApproval: (input: unknown) => Promise<boolean> }
  ).needsApproval(input)
}

test('once-approved file calls read, write and edit outside without remembering access', async () => {
  const read = await createReadFileTool(context)
  const write = await createWriteFileTool(context)
  const edit = await createEditFileTool(context)
  const readInput = { path: 'external/note' }
  const writeInput = {
    path: path.join(outside, 'new', '$approved.txt'),
    content: 'first version',
  }
  const editInput = {
    path: '../outside/new/$approved.txt',
    edits: [{ oldText: 'first', newText: 'second' }],
  }

  for (const [tool, input] of [
    [read, readInput],
    [write, writeInput],
    [edit, editInput],
  ] as const) {
    const schema = tool.inputSchema as ZodType
    expect(schema.safeParse(input).success).toBe(true)
    expect(
      schema.safeParse({ ...input, allowOutsideWorkspace: true }).success,
    ).toBe(false)
  }

  expect(await needsApproval(read, readInput)).toBe(true)
  expect(await needsApproval(write, writeInput)).toBe(true)
  expect(await needsApproval(edit, editInput)).toBe(true)
  // Execution models Allow for this call, without adding a saved path grant.
  const result = await read.execute!(readInput, options)
  expect(JSON.parse(result as string).content).toBe('external note')
  await write.execute!(writeInput, options)
  await edit.execute!(editInput, options)
  expect(await readFile(writeInput.path, 'utf8')).toBe('second version')

  expect(approvals).toEqual({})
  expect(await needsApproval(read, readInput)).toBe(true)
  expect(await needsApproval(write, writeInput)).toBe(true)
  expect(await needsApproval(edit, editInput)).toBe(true)
  await expect(
    callMcpTool('read_file', {
      sessionId: context.sessionId,
      workspaceId: context.workspaceId,
      workspace: context.workspace,
      path: writeInput.path,
    }),
  ).rejects.toThrow('Path escapes the configured workspace')
})

test('unrestricted file execution reaches external files without a saved path grant', async () => {
  approvals = { mode: 'unrestricted' }
  try {
    const read = await createReadFileTool(context)
    const input = { path: path.join(outside, 'note') }
    expect(await needsApproval(read, input)).toBe(false)
    const result = await read.execute!(input, options)
    expect(JSON.parse(result as string).content).toBe('external note')
  } finally {
    approvals = {}
  }
})

async function sessionApprovalFixture(scope: 'project' | 'personal') {
  const database = skillsDatabase()
  const hasProject = scope === 'project'
  if (hasProject) {
    await database.db.insert('sessionFolders', {
      _id: context.workspaceId,
      ownerId: 'owner',
      name: 'Project',
      revision: 0,
      sources: context.workspace!.sources,
    })
  }
  await database.db.insert('sessions', {
    _id: context.sessionId,
    ownerId: 'owner',
    ...(hasProject && { folderId: context.workspaceId }),
  })
  const session = await getSessionWithWorkspace(database.ctx, context.sessionId)
  const liveApprovals = () => getApprovals(database.ctx, context.sessionId)
  const workspace = hasProject
    ? context.workspace!
    : withAgentHome(undefined, {
        agentId: 'agent',
        ownerId: 'owner',
        path: project,
        revision: 0,
      })
  return {
    ...database,
    session: session!,
    liveApprovals,
    toolContext: {
      ...context,
      workspace,
      workspaceId: workspace.workspaceId,
      approvals: liveApprovals,
    },
  }
}

test.each([
  ['read_file', 'project'],
  ['write_file', 'project'],
  ['edit_file', 'project'],
  ['shell', 'project'],
  ['read_file', 'personal'],
] as const)(
  '%s approval remembers the external path without broadening access (%s)',
  async (toolName, scope) => {
    const fixture = await sessionApprovalFixture(scope)
    const folderApproval = toolName === 'shell'
    const filePath =
      scope === 'personal'
        ? path.join(project, 'external/note')
        : 'external/note'
    const input = folderApproval
      ? { command: 'ls', cwd: outside }
      : { path: filePath }
    const grant = folderApproval ? outside : path.join(outside, 'note')
    const unapprovedPath = folderApproval
      ? path.join(root, 'outside-sibling', 'note')
      : path.join(outside, 'sibling')
    const setup = {
      stream: { sessionId: context.sessionId },
      workspaceSessionId: context.sessionId,
      workspace: fixture.toolContext.workspace,
      agent: {},
    } as Parameters<typeof attachApprovalPreviews>[1]
    const action = {
      runQuery: fixture.liveApprovals,
    } as unknown as Parameters<typeof attachApprovalPreviews>[0]
    const parts = await attachApprovalPreviews(action, setup, [
      {
        type: `tool-${toolName}`,
        toolCallId: options.toolCallId,
        state: 'approval-requested',
        approval: { id: 'file-approval' },
        input,
      },
    ])
    const request = parts[0] as (typeof parts)[number] & {
      approvalPathStatus?: 'paths'
      approvalPaths?: string[]
    }
    expect(request.approvalPaths).toEqual([grant])
    const hold = approvalHold(toolName, input, undefined, request.approvalPathStatus) // prettier-ignore
    const choices = buildApprovalActions(true, alwaysLabel(toolName, input, {}), hold) // prettier-ignore
    const remembered = choices.find((choice) => choice.remember)
    expect(remembered?.remember).toBe('paths')

    const { matched } = patchToolApproval(parts, {
      toolCallId: options.toolCallId,
      approved: true,
    })
    await rememberApproval(fixture.ctx, fixture.session, matched, remembered!.remember!) // prettier-ignore
    expect(await fixture.liveApprovals()).toEqual({
      paths: [grant],
    })
    for (const tool of await Promise.all([
      createReadFileTool(fixture.toolContext),
      createWriteFileTool(fixture.toolContext),
      createEditFileTool(fixture.toolContext),
    ])) {
      expect(await needsApproval(tool, { path: filePath })).toBe(false)
      expect(await needsApproval(tool, { path: unapprovedPath })).toBe(true)
      if (folderApproval) {
        expect(
          await needsApproval(tool, { path: path.join(outside, 'new/note') }),
        ).toBe(false)
        expect(
          await needsApproval(tool, {
            path: path.join(outside, '.git/config'),
          }),
        ).toBe(true)
      }
    }
  },
)
