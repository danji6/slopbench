import type { WorkspaceToolContext } from '@sb/convex/model/tool/context'
import {
  createEditFileTool,
  createReadFileTool,
  createWriteFileTool,
} from '@sb/convex/model/tool/files'
import { callMcpTool } from '@sb/convex/model/tool/mcp'
import type { ToolApprovals } from '@sb/core/types'
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
