/// <reference types="bun-types" />
import type { WorkspaceToolContext } from '@sb/convex/model/tool/context'
import {
  createEditFileTool,
  createReadFileTool,
  createWriteFileTool,
} from '@sb/convex/model/tool/files'
import { createShellTool } from '@sb/convex/model/tool/shellTools'
import { describe, expect, test } from 'bun:test'

const context = {
  sessionId: 'session_1',
  ownerId: 'session_1',
  workspaceId: 'workspace_1',
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
