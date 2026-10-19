import { TOOL_DESCRIPTIONS, shellToolDescription } from '@sb/core/types'
import { parseScopedPath } from '@sb/core/workspace/scoped-path'

import {
  analyzeShellPathCandidates,
  isReadOnlyShellCommand,
  isToolAutoApproved,
  isUnrestrictedAccess,
} from '../../lib/tool/approval'
import type { ShellToolOutput } from '../../types'
import {
  type WatchedJobRef,
  type WorkspaceToolContext,
  workspaceArgs,
} from './context'
import { checkToolPaths } from './paths'
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
    description: shellToolDescription(
      context.shell,
      context.hasAgentHome ?? !!context.workspace?.agentHome,
    ),
    inputSchema: z.strictObject({
      cwd: z
        .string()
        .optional()
        .describe(
          'Working directory: workspace-relative, absolute, workspace:// or agent:// (default: workspace://)',
        ),
      command: z.string().describe('Shell command to execute'),
      description: z
        .string()
        .optional()
        .describe('Short one-line summary of what the command does'),
      timeout: z.number().min(1).optional().describe('Timeout in seconds'),
      run_in_background: z
        .boolean()
        .optional()
        .describe('Run in the background and return the job id immediately'),
    }),
    needsApproval: (input) =>
      shellNeedsApproval(input.command, context, input.cwd),
    toModelOutput: shellToModelOutput,
    execute: async function* (input, { abortSignal, toolCallId }) {
      const approvals = await context.approvals?.()
      // Reaching execute means this invocation passed its approval gate
      const cwdGrant =
        input.cwd && !parseScopedPath(input.cwd).explicit ? [input.cwd] : []
      const allowedPaths = [...(approvals?.paths ?? []), ...cwdGrant]
      yield* trackJob(
        executeShellJob(
          {
            ...workspaceArgs(context),
            ...jobRef(context, toolCallId),
            allowedPaths,
          },
          input,
          { abortSignal },
        ),
        context,
        { command: input.command, toolCallId },
      )
    },
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
    execute: async function* (input, { abortSignal, toolCallId }) {
      yield* trackJob(
        executeShellOutput(workspaceArgs(context), input, { abortSignal }),
        context,
        { command: `shell_output ${input.jobId}`, toolCallId },
      )
    },
  })
}

export async function createKillShellTool(context: WorkspaceToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool({
    description: TOOL_DESCRIPTIONS.kill_shell,
    inputSchema: z.object({
      jobId: z.string().describe('Job id returned by shell'),
    }),
    execute: async ({ jobId }) => {
      // Killing it is the agent saying it no longer wants the result
      await context.releaseJob?.(jobId)
      return killShell(workspaceArgs(context), jobId)
    },
  })
}

/**
 * Passes a shell tool's output through, then settles the job's watch by its
 * final state.
 */
export async function* trackJob(
  outputs: AsyncGenerator<ShellToolOutput>,
  context: WorkspaceToolContext,
  ref: Omit<WatchedJobRef, 'jobId'>,
): AsyncGenerator<ShellToolOutput> {
  let last: ShellToolOutput | undefined
  for await (const output of outputs) {
    last = output
    yield output
  }

  if (!last?.jobId) return
  if (last.status === 'background') {
    await context.watchJob?.({ ...ref, jobId: last.jobId })
  } else {
    await context.releaseJob?.(last.jobId)
  }
}

/** Lets the UI find a running job's terminal without its tool output. */
function jobRef(context: WorkspaceToolContext, toolCallId: string) {
  return {
    messageId: context.messageId,
    messageCreatedAt: context.messageCreatedAt,
    toolCallId,
  }
}

async function shellNeedsApproval(
  command: string,
  context: WorkspaceToolContext,
  cwd = 'workspace://',
): Promise<boolean> {
  const approvals = await context.approvals?.()
  if (isUnrestrictedAccess(approvals)) return false
  if (!isReadOnlyShellCommand(command) && (await context.isPlanMode?.())) {
    return true
  }
  if (!isToolAutoApproved('shell', { command }, approvals)) return true
  const { candidates, complete } = analyzeShellPathCandidates(command)
  if (!complete) return true
  const result = await checkToolPaths(
    candidates,
    context,
    approvals?.paths,
    false,
    cwd,
  )
  return !result?.complete || result.uncovered.length > 0
}

/**
 * Ask the sidecar which paths referenced by the command are sensitive
 * (git-ignored or outside the workspace).
 */
export async function getFlaggedPaths(
  command: string,
  context: Pick<WorkspaceToolContext, 'sessionId' | 'workspaceId' | 'workspace'>, // prettier-ignore
  cwd = 'workspace://',
): Promise<string[] | null> {
  const { candidates: paths, complete } = analyzeShellPathCandidates(command)
  if (!complete) return null

  const result = await checkToolPaths(paths, context, [], false, cwd)
  return result?.complete ? result.flagged : null
}
