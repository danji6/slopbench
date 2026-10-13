import {
  TOOL_DESCRIPTIONS,
  editFileFields,
  fileScopeDescription,
  fileToolDescription,
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
    description: fileToolDescription(
      TOOL_DESCRIPTIONS.read_file,
      !!context.workspace?.agentHome,
    ),
    inputSchema: z.object(scopedFields(readFileFields, context)),
    needsApproval: ({ path, scope }) =>
      fileNeedsApproval('read_file', path, fileContext(context, scope, path)),
    execute: async ({ path, offset, limit, byteOffset, scope }) =>
      callMcpTool('read_file', {
        ...workspaceArgs(fileContext(context, scope, path)),
        allowedPaths: (await context.approvals?.())?.paths,
        path,
        scope,
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
    inputSchema: z.object(scopedFields(writeFileFields, context)),
    needsApproval: ({ path, scope }) =>
      fileNeedsApproval('write_file', path, fileContext(context, scope, path)),
    execute: async ({ path, content, scope }) => {
      await assertNotPlanMode(context)
      return callMcpTool('write_file', {
        ...workspaceArgs(fileContext(context, scope, path)),
        allowedPaths: (await context.approvals?.())?.paths,
        path,
        scope,
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
    inputSchema: z.object(scopedFields(editFileFields, context)),
    needsApproval: ({ path, scope }) =>
      fileNeedsApproval('edit_file', path, fileContext(context, scope, path)),
    execute: async ({ path, edits, scope }) => {
      await assertNotPlanMode(context)
      return callMcpTool('edit_file', {
        ...workspaceArgs(fileContext(context, scope, path)),
        allowedPaths: (await context.approvals?.())?.paths,
        path,
        scope,
        edits,
      })
    },
  })
}

/** Keeps shared schemas unchanged while tailoring each tool's scope guidance. */
function scopedFields<T extends { scope: typeof readFileFields.scope }>(
  fields: T,
  context: WorkspaceToolContext,
) {
  return {
    ...fields,
    scope: fields.scope.describe(
      fileScopeDescription(!!context.workspace?.agentHome),
    ),
  }
}

function fileContext(
  context: WorkspaceToolContext,
  scope?: FileScope,
  path?: string,
): WorkspaceToolContext {
  if (!context.workspace)
    throw new ToolError('Filesystem context is unavailable')
  return {
    ...context,
    workspace: selectFileWorkspace(context.workspace, scope, path),
  }
}
