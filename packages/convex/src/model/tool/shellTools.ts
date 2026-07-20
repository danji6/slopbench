import { TOOL_DESCRIPTIONS } from '@sb/core/types'

import {
  commandReferencesForbiddenPath,
  extractPathCandidates,
  isPathAllowed,
  isReadOnlyShellCommand,
  isToolAutoApproved,
} from '../../lib/tool/approval'
import type { ShellToolOutput } from '../../types'
import { type WorkspaceToolContext, workspaceArgs } from './context'
import { callMcpTool } from './mcp'
import {
  type ShellJobInput,
  type ShellOutputInput,
  executeShellJob,
  executeShellOutput,
  killShell,
  shellToModelOutput,
} from './shell'

export async function createShellTool(context: WorkspaceToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool<ShellJobInput, ShellToolOutput, never>({
    description: TOOL_DESCRIPTIONS.shell,
    inputSchema: z.object({
      command: z.string().describe('Shell command to execute'),
      timeout: z.number().optional().describe('Timeout in seconds'),
      run_in_background: z
        .boolean()
        .optional()
        .describe('Run in the background and return the job id immediately'),
    }),
    needsApproval: (input) => shellNeedsApproval(input.command, context),
    toModelOutput: shellToModelOutput,
    execute: (input, { abortSignal }) =>
      executeShellJob(workspaceArgs(context), input, { abortSignal }),
  })
}

export async function createShellOutputTool(context: WorkspaceToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool<ShellOutputInput, ShellToolOutput, never>({
    description: TOOL_DESCRIPTIONS.shell_output,
    inputSchema: z.object({
      jobId: z.string().describe('Job id returned by shell'),
      wait_seconds: z.number().optional(),
    }),
    toModelOutput: shellToModelOutput,
    execute: (input, { abortSignal }) =>
      executeShellOutput(workspaceArgs(context), input, { abortSignal }),
  })
}

export async function createKillShellTool(context: WorkspaceToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool({
    description: TOOL_DESCRIPTIONS.kill_shell,
    inputSchema: z.object({
      jobId: z.string().describe('Job id returned by shell'),
    }),
    execute: ({ jobId }) => killShell(workspaceArgs(context), jobId),
  })
}

async function shellNeedsApproval(
  command: string,
  context: WorkspaceToolContext,
): Promise<boolean> {
  if (commandReferencesForbiddenPath(command)) return true
  if (!isReadOnlyShellCommand(command) && (await context.isPlanMode?.())) {
    return true
  }
  if (!isToolAutoApproved('shell', { command }, context.approvals)) return true
  const flagged = await getFlaggedPaths(command, context)
  if (flagged === null) return true
  const allowed = context.approvals?.paths ?? []
  return flagged.some((path) => !isPathAllowed(path, allowed))
}

/**
 * Ask the sidecar which paths referenced by the command are sensitive
 * (git-ignored or outside the workspace).
 */
export async function getFlaggedPaths(
  command: string,
  context: Pick<WorkspaceToolContext, 'sessionId' | 'workspaceId'>,
): Promise<string[] | null> {
  const paths = extractPathCandidates(command)
  if (paths.length === 0) return []

  try {
    const text = await callMcpTool('check_paths', {
      sessionId: context.sessionId,
      workspaceId: context.workspaceId,
      paths,
    })
    const result = JSON.parse(text) as { flagged?: string[] }
    return result.flagged ?? []
  } catch {
    return null
  }
}
