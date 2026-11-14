/// <reference types="bun-types" />
import type { WorkspaceToolContext } from '@cv/convex/model/tool/context'
import {
  createEditFileTool,
  createReadFileTool,
  createWriteFileTool,
} from '@cv/convex/model/tool/files'
import { filesystemWorkspace } from '@cv/convex/model/tool/sessionFilesystem'
import { createShellTool } from '@cv/convex/model/tool/shellTools'
import { withAgentHome } from '@cv/core/workspace/personal'
import { describe, expect, test } from 'bun:test'

const context = {
  sessionId: 'session_1',
  ownerId: 'session_1',
  workspaceId: 'workspace_1',
  workspace: {
    workspaceId: 'workspace',
    path: '/fixture',
    label: 'Fixture',
    sources: [{ id: 'fixture', path: '/fixture', label: 'Fixture' }],
  },
  approvals: async () => ({ mode: 'unrestricted' as const }),
  isPlanMode: async () => true,
} as WorkspaceToolContext

type ApprovalTool = {
  needsApproval?:
    boolean | ((input: never, options: never) => boolean | PromiseLike<boolean>)
}

async function asksForApproval(tool: unknown, input: unknown) {
  const predicate = (tool as ApprovalTool).needsApproval
  return typeof predicate === 'function'
    ? predicate(input as never, {} as never)
    : Boolean(predicate)
}

describe('unrestricted approval mode', () => {
  test('bypasses shell approval checks before inspecting the command', async () => {
    const tool = await createShellTool(context)
    expect(await asksForApproval(tool, { command: 'rm -rf .git' })).toBe(false)
  })

  test('bypasses shell approval for session and personal directories without a workspace', async () => {
    const workspace = withAgentHome(undefined, {
      agentId: 'agent',
      ownerId: 'owner',
      path: '/agent-home',
      revision: 1,
    })
    const tool = await createShellTool({
      ...context,
      workspace: filesystemWorkspace({
        _id: context.sessionId,
        workspace: { ...workspace, folderId: undefined },
      }),
    })

    for (const cwd of ['session://', 'agent://']) {
      expect(
        await asksForApproval(tool, { command: 'python script.py', cwd }),
      ).toBe(false)
    }
  })

  test('bypasses forbidden-path and write approvals', async () => {
    const tools = await Promise.all([
      createReadFileTool(context),
      createWriteFileTool(context),
      createEditFileTool(context),
    ])

    for (const tool of tools) {
      expect(await asksForApproval(tool, { path: '.git/config' })).toBe(false)
    }
  })
})
