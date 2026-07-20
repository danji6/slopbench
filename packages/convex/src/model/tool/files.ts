import {
  TOOL_DESCRIPTIONS,
  editFileFields,
  readFileFields,
  writeFileFields,
} from '@sb/core/types'

import { ToolError } from '../../errors'
import { isPathForbidden, isToolAutoApproved } from '../../lib/tool/approval'
import { type WorkspaceToolContext, workspaceArgs } from './context'
import { callMcpTool } from './mcp'

export async function createReadFileTool(context: WorkspaceToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool({
    description: TOOL_DESCRIPTIONS.read_file,
    inputSchema: z.object(readFileFields),
    needsApproval: ({ path }) => isPathForbidden(path),
    execute: ({ path, offset, limit }) =>
      callMcpTool('read_file', {
        ...workspaceArgs(context),
        path,
        offset,
        limit,
      }),
  })
}

async function assertNotPlanMode(context: WorkspaceToolContext) {
  if (await context.isPlanMode?.()) {
    throw new ToolError(
      'Plan mode is active, you CANNOT modify files. Keep researching and refine the plan.',
    )
  }
}

export async function createWriteFileTool(context: WorkspaceToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool({
    description: TOOL_DESCRIPTIONS.write_file,
    inputSchema: z.object(writeFileFields),
    needsApproval: ({ path }) =>
      isPathForbidden(path) ||
      !isToolAutoApproved('write_file', undefined, context.approvals),
    execute: async ({ path, content }) => {
      await assertNotPlanMode(context)
      return callMcpTool('write_file', {
        ...workspaceArgs(context),
        path,
        content,
      })
    },
  })
}

export async function createEditFileTool(context: WorkspaceToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool({
    description: TOOL_DESCRIPTIONS.edit_file,
    inputSchema: z.object(editFileFields),
    needsApproval: ({ path }) =>
      isPathForbidden(path) ||
      !isToolAutoApproved('edit_file', undefined, context.approvals),
    execute: async ({ path, edits }) => {
      await assertNotPlanMode(context)
      return callMcpTool('edit_file', {
        ...workspaceArgs(context),
        path,
        edits,
      })
    },
  })
}
