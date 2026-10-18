import {
  TOOL_DESCRIPTIONS,
  editFileFields,
  fileToolDescription,
  readFileFields,
  writeFileFields,
} from '@sb/core/types'

import { ToolError } from '../../errors'
import { type WorkspaceToolContext, fileWorkspaceArgs } from './context'
import { callMcpTool } from './mcp'
import { fileNeedsApproval } from './paths'

export async function createReadFileTool(context: WorkspaceToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool({
    description: fileToolDescription(
      TOOL_DESCRIPTIONS.read_file,
      !!context.workspace?.agentHome,
    ),
    inputSchema: z.strictObject(readFileFields),
    needsApproval: ({ path }) => fileNeedsApproval('read_file', path, context),
    execute: async ({ path, offset, limit, byteOffset }) =>
      callMcpTool('read_file', {
        ...fileWorkspaceArgs(context),
        allowedPaths: (await context.approvals?.())?.paths,
        path,
        offset,
        limit,
        byteOffset,
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
    description: fileToolDescription(
      TOOL_DESCRIPTIONS.write_file,
      !!context.workspace?.agentHome,
    ),
    inputSchema: z.strictObject(writeFileFields),
    needsApproval: ({ path }) => fileNeedsApproval('write_file', path, context),
    execute: async ({ path, content }) => {
      await assertNotPlanMode(context)
      return callMcpTool('write_file', {
        ...fileWorkspaceArgs(context),
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
    description: fileToolDescription(
      TOOL_DESCRIPTIONS.edit_file,
      !!context.workspace?.agentHome,
    ),
    inputSchema: z.strictObject(editFileFields),
    needsApproval: ({ path }) => fileNeedsApproval('edit_file', path, context),
    execute: async ({ path, edits }) => {
      await assertNotPlanMode(context)
      return callMcpTool('edit_file', {
        ...fileWorkspaceArgs(context),
        allowedPaths: (await context.approvals?.())?.paths,
        path,
        edits,
      })
    },
  })
}
