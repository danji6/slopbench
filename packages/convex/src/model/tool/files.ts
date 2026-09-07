import {
  TOOL_DESCRIPTIONS,
  editFileFields,
  readFileFields,
  writeFileFields,
} from '@sb/core/types'

import { ToolError } from '../../errors'
import { type WorkspaceToolContext, workspaceArgs } from './context'
import { callMcpTool } from './mcp'
import { fileNeedsApproval } from './paths'

export async function createReadFileTool(context: WorkspaceToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool({
    description: TOOL_DESCRIPTIONS.read_file,
    inputSchema: z.object(readFileFields),
    needsApproval: ({ path }) => fileNeedsApproval('read_file', path, context),
    execute: async ({ path, offset, limit }) =>
      callMcpTool('read_file', {
        ...workspaceArgs(context),
        allowedPaths: (await context.approvals?.())?.paths,
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
    needsApproval: ({ path }) => fileNeedsApproval('write_file', path, context),
    execute: async ({ path, content }) => {
      await assertNotPlanMode(context)
      return callMcpTool('write_file', {
        ...workspaceArgs(context),
        allowedPaths: (await context.approvals?.())?.paths,
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
    needsApproval: ({ path }) => fileNeedsApproval('edit_file', path, context),
    execute: async ({ path, edits }) => {
      await assertNotPlanMode(context)
      return callMcpTool('edit_file', {
        ...workspaceArgs(context),
        allowedPaths: (await context.approvals?.())?.paths,
        path,
        edits,
      })
    },
  })
}
