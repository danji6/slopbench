import {
  TOOL_DESCRIPTIONS,
  editFileFields,
  readFileFields,
  writeFileFields,
} from '@sb/core/types'
import { selectFileWorkspace } from '@sb/core/workspace/personal'
import type { FileScope } from '@sb/core/workspace/personal'

import { ToolError } from '../../errors'
import { type WorkspaceToolContext, workspaceArgs } from './context'
import { callMcpTool } from './mcp'
import { fileNeedsApproval } from './paths'

export async function createReadFileTool(context: WorkspaceToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool({
    description: TOOL_DESCRIPTIONS.read_file,
    inputSchema: z.object(readFileFields),
    needsApproval: ({ path, scope }) =>
      fileNeedsApproval('read_file', path, fileContext(context, scope)),
    execute: async ({ path, offset, limit, byteOffset, scope }) =>
      callMcpTool('read_file', {
        ...workspaceArgs(fileContext(context, scope)),
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
    description: TOOL_DESCRIPTIONS.write_file,
    inputSchema: z.object(writeFileFields),
    needsApproval: ({ path, scope }) =>
      fileNeedsApproval('write_file', path, fileContext(context, scope)),
    execute: async ({ path, content, scope }) => {
      await assertNotPlanMode(context)
      return callMcpTool('write_file', {
        ...workspaceArgs(fileContext(context, scope)),
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
    needsApproval: ({ path, scope }) =>
      fileNeedsApproval('edit_file', path, fileContext(context, scope)),
    execute: async ({ path, edits, scope }) => {
      await assertNotPlanMode(context)
      return callMcpTool('edit_file', {
        ...workspaceArgs(fileContext(context, scope)),
        allowedPaths: (await context.approvals?.())?.paths,
        path,
        edits,
      })
    },
  })
}

function fileContext(
  context: WorkspaceToolContext,
  scope?: FileScope,
): WorkspaceToolContext {
  if (!scope) return context
  if (!context.workspace)
    throw new ToolError('Filesystem context is unavailable')
  return {
    ...context,
    workspace: selectFileWorkspace(context.workspace, scope),
  }
}
