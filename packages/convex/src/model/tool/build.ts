import { ASK_TOOL_NAME } from '@sb/core/const'
import { READ_ATTACHMENT_TOOL_NAME } from '@sb/core/const'
import type { ToolSet } from 'ai'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { TASK_TOOL_NAME, sharedSessionId } from '../../lib/subagent'
import { mergeToolApprovals } from '../../lib/tool/approval'
import type { Session, StreamExecutionArgs } from '../../types'
import type { AgentAutoApprove, ToolApprovals } from '../../types'
import { createAskTool } from './ask'
import { createReadAttachmentTool } from './attachments'
import type { PlanToolContext, WorkspaceToolContext } from './context'
import {
  createEditFileTool,
  createReadFileTool,
  createWriteFileTool,
} from './files'
import { guardFilesystemTool } from './filesystemGuard'
import type { McpManifestEntry, ToolManifest } from './manifest'
import { createExternalMcpTool } from './mcp'
import { createMcpBrokerTools } from './mcpBroker'
import type { McpOperationContext } from './mcpOperation'
import { createMcpProtocolTools } from './mcpProtocol'
import {
  createEditPlanTool,
  createEnterPlanModeTool,
  createExitPlanModeTool,
  createWritePlanTool,
  isPlanMode,
  withPlanModeReminders,
} from './plan'
import { EMPTY_TOOL_RESOURCES, type ToolResources } from './settings'
import {
  createKillShellTool,
  createShellOutputTool,
  createShellTool,
} from './shellTools'
import { createListSkillsTool, createReadSkillTool } from './skills'
import type { SkillsContext } from './skills'
import { createTaskTool } from './task'
import { createEditTodoTool, createWriteTodoTool } from './todo'
import { createWebFetchTool, createWebSearchTool } from './web'

/** Session data the tool builder needs. */
export type ToolSession = Pick<Session, '_id' | 'workspace' | 'parent'> & {
  toolApprovals?: ToolApprovals
}

export type ToolBuildOptions = {
  omitMcpMedia?: boolean
  ctx?: ActionCtx
  /** The agent's own approvals, merged into the session's. */
  autoApprove?: AgentAutoApprove
  /** Message this turn writes into. */
  messageId?: Id<'messages'>
  messageCreatedAt?: number
  /** Agent and invoker a backgrounded shell job reports back as. */
  agentId?: Id<'agents'>
  invokedBy?: Id<'users'>
  execution?: StreamExecutionArgs
}

/**
 * Builds the tool set from a cached manifest, kept stable to prevent provider
 * cache invalidation.
 */
export async function getEnabledTools(
  manifest: ToolManifest,
  session?: ToolSession,
  resources?: ToolResources | null,
  options?: ToolBuildOptions,
): Promise<ToolSet> {
  const ctx = options?.ctx
  const sessionId = session ? sharedSessionId(session) : undefined

  // Approvals can be remembered mid-turn
  const approvals = session
    ? () => resolveApprovals(session, options)
    : undefined

  const workspace: WorkspaceToolContext | undefined =
    session && sessionId
      ? {
          sessionId,
          ownerId: session._id,
          messageId: options?.messageId,
          messageCreatedAt: options?.messageCreatedAt,
          workspaceId: session.workspace?.workspaceId ?? sessionId,
          workspace: session.workspace,
          hasAgentHome: manifest.hasAgentHome ?? false,
          shell: manifest.shell,
          allowInteractiveShells:
            resources?.settings?.allowInteractiveShells ?? false,
          approvals,
          // Plan mode can be entered or approved mid-turn
          isPlanMode: ctx ? () => isPlanMode(ctx, sessionId) : undefined,
          ...jobWatch(session, options),
        }
      : undefined

  const planContext: PlanToolContext | undefined =
    ctx && sessionId ? { ctx, sessionId, approvals } : undefined

  const mcpByName = new Map((manifest.mcp ?? []).map((e) => [e.name, e]))
  const tools: ToolSet = {}

  for (const name of manifest.names) {
    const built = await createManifestTool(name, {
      manifest,
      mcpByName,
      resources: resources ?? EMPTY_TOOL_RESOURCES,
      workspace,
      skillsContext:
        ctx && options?.agentId && session
          ? {
              ctx,
              agentId: options.agentId,
              workspace: session.workspace,
              execution: options.execution,
            }
          : undefined,
      planContext,
      mcpApprovals: approvals,
      mcpOperation:
        ctx && options?.execution && options.messageId
          ? {
              ctx,
              execution: options.execution,
              messageId: options.messageId,
              omitMedia: options.omitMcpMedia,
            }
          : undefined,
      mcpFailed: ctx
        ? async (runtimeId, key, reason) => {
            await ctx.runMutation(internal.mcp._updateRuntimeStatus, {
              runtimeId,
              key,
              state: 'lost',
              reason,
            })
          }
        : undefined,
      mcpConnected: ctx
        ? async (runtimeId, key, bootId, generation, initialization) =>
            ctx.runMutation(internal.mcp._connected, {
              runtimeId,
              key,
              bootId,
              generation,
              initialization,
            })
        : undefined,
      mcpExecution:
        ctx && sessionId && options?.agentId
          ? (serverKey, toolName) =>
              ctx.runMutation(internal.mcp._getExecution, {
                sessionId: session!._id,
                agentId: options.agentId!,
                serverKey,
                toolName,
                ...options?.execution,
              })
          : undefined,
    })
    if (built)
      tools[name] = guardFilesystemTool(name, built, workspace, options)
  }

  return withPlanModeReminders(tools, planContext)
}

/**
 * Watch callbacks for jobs that outlive their tool call. They are addressed by
 * the session that owns the turn, which is the one their report wakes.
 */
function jobWatch(
  session: ToolSession,
  options?: ToolBuildOptions,
): Pick<WorkspaceToolContext, 'watchJob' | 'releaseJob'> {
  const { ctx, agentId, invokedBy } = options ?? {}
  if (!ctx || !agentId || !invokedBy) return {}

  return {
    watchJob: async (job) => {
      await ctx.runMutation(internal.shellJobs._register, {
        sessionId: session._id,
        agentId,
        invokedBy,
        ...job,
      })
    },
    releaseJob: async (jobId) => {
      await ctx.runMutation(internal.shellJobs._release, {
        sessionId: session._id,
        jobId,
      })
    },
  }
}

/**
 * Reads the main session's live approval policy for every agent in the task.
 * Falls back to the caller's snapshot when there is no ctx.
 */
async function resolveApprovals(
  session: ToolSession,
  options?: ToolBuildOptions,
): Promise<ToolApprovals | undefined> {
  const live = options?.ctx
    ? await options.ctx.runQuery(internal.sessions._getApprovals, {
        sessionId: session._id,
      })
    : session.toolApprovals

  return mergeToolApprovals(live ?? undefined, options?.autoApprove)
}

type AnyTool = ToolSet[string]

type McpExecution = (
  serverKey: string,
  toolName?: string,
) => ReturnType<NonNullable<Parameters<typeof createExternalMcpTool>[2]>>

type BuildContext = {
  skillsContext?: SkillsContext
  manifest: ToolManifest
  mcpByName: Map<string, McpManifestEntry>
  resources: ToolResources
  workspace?: WorkspaceToolContext
  planContext?: PlanToolContext
  mcpFailed?: (
    runtimeId: Id<'mcpRuntimes'>,
    key: string,
    reason: string,
  ) => Promise<void>
  mcpApprovals?: () => Promise<ToolApprovals | undefined>
  mcpOperation?: McpOperationContext
  mcpConnected?: (
    runtimeId: Id<'mcpRuntimes'>,
    key: string,
    bootId: string,
    generation: string,
    initialization?: string,
  ) => Promise<boolean>
  mcpExecution?: McpExecution
}

/** Constructs one tool by its cached name. */
async function createManifestTool(
  name: string,
  build: BuildContext,
): Promise<AnyTool | undefined> {
  const { workspace, planContext } = build

  switch (name) {
    case 'mcp_protocol':
    case 'read_mcp_output':
    case 'search_mcp_tools':
    case 'call_mcp_tool': {
      if (!build.mcpOperation || !build.mcpExecution) return undefined
      const create =
        name === 'mcp_protocol' || name === 'read_mcp_output'
          ? createMcpProtocolTools
          : createMcpBrokerTools
      const broker = await create({
        operation: build.mcpOperation,
        current: build.mcpExecution,
        connected: build.mcpConnected,
        approvals: build.mcpApprovals,
        failed: build.mcpFailed,
      })
      return (broker as Record<string, AnyTool>)[name]
    }
    case 'web_fetch':
      return createWebFetchTool()
    case 'web_search':
      return createWebSearchTool(build.resources.settings)
    case READ_ATTACHMENT_TOOL_NAME:
      return (planContext && (createReadAttachmentTool(planContext.ctx) as Promise<AnyTool>)) // prettier-ignore
    case 'read_skill':
      return build.skillsContext && createReadSkillTool(build.skillsContext)
    case 'list_skills':
      return build.skillsContext && createListSkillsTool(build.skillsContext)
    case 'read_file':
      return workspace && createReadFileTool(workspace)
    case 'write_file':
      return workspace && createWriteFileTool(workspace)
    case 'edit_file':
      return workspace && createEditFileTool(workspace)
    // Streaming tools carry narrower generics than the ToolSet value type
    case 'shell':
      return workspace && (createShellTool(workspace) as Promise<AnyTool>)
    case 'shell_output':
      return workspace && (createShellOutputTool(workspace) as Promise<AnyTool>)
    case 'kill_shell':
      return workspace && createKillShellTool(workspace)
    case 'write_plan':
      return planContext && createWritePlanTool(planContext)
    case 'edit_plan':
      return planContext && createEditPlanTool(planContext)
    case 'enter_plan_mode':
      return planContext && createEnterPlanModeTool(planContext)
    case 'exit_plan_mode':
      return planContext && createExitPlanModeTool(planContext)
    case 'write_todo':
      return planContext && createWriteTodoTool(planContext)
    case 'edit_todo':
      return planContext && createEditTodoTool(planContext)
    case ASK_TOOL_NAME:
      return createAskTool()
    case TASK_TOOL_NAME:
      return createTaskTool(build.manifest.taskRoster ?? '')
  }

  const entry = build.mcpByName.get(name)
  if (!entry) return undefined

  return createExternalMcpTool(
    entry,
    build.resources.mcpServers,
    build.mcpExecution
      ? () => build.mcpExecution!(entry.serverId, entry.toolName)
      : undefined,
    build.mcpConnected,
    build.mcpApprovals,
    build.mcpFailed,
    build.mcpOperation,
  )
}
