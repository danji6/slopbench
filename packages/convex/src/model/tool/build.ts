import type { ToolSet } from 'ai'

import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { TASK_TOOL_NAME, sharedSessionId } from '../../lib/subagent'
import { mergeToolApprovals } from '../../lib/tool/approval'
import type { AgentAutoApprove, ToolApprovals } from '../../types'
import type { PlanToolContext, WorkspaceToolContext } from './context'
import {
  createEditFileTool,
  createReadFileTool,
  createWriteFileTool,
} from './files'
import type { McpManifestEntry, ToolManifest } from './manifest'
import { createExternalMcpTool } from './mcp'
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
import { createTaskTool } from './task'
import { createEditTodoTool, createWriteTodoTool } from './todo'
import { createWebFetchTool, createWebSearchTool } from './web'

/** Session data the tool builder needs. */
export type ToolSession = Pick<
  Doc<'sessions'>,
  '_id' | 'workspace' | 'parent'
> & { toolApprovals?: ToolApprovals }

export type ToolBuildOptions = {
  ctx?: ActionCtx
  /** The agent's own approvals, merged into the session's. */
  autoApprove?: AgentAutoApprove
  /** Message this turn writes into. */
  messageId?: Id<'messages'>
  messageCreatedAt?: number
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

  const workspace: WorkspaceToolContext | undefined =
    session?.workspace && sessionId
      ? {
          sessionId,
          ownerId: session._id,
          messageId: options?.messageId,
          messageCreatedAt: options?.messageCreatedAt,
          workspaceId: session.workspace.workspaceId,
          shell: manifest.shell,
          // Approvals can be remembered mid-turn
          approvals: () => resolveApprovals(session, options),
          // Plan mode can be entered or approved mid-turn
          isPlanMode: ctx ? () => isPlanMode(ctx, sessionId) : undefined,
        }
      : undefined

  const planContext: PlanToolContext | undefined =
    ctx && sessionId ? { ctx, sessionId } : undefined

  const mcpByName = new Map((manifest.mcp ?? []).map((e) => [e.name, e]))
  const tools: ToolSet = {}

  for (const name of manifest.names) {
    const built = await createManifestTool(name, {
      manifest,
      mcpByName,
      resources: resources ?? EMPTY_TOOL_RESOURCES,
      workspace,
      planContext,
    })
    if (built) tools[name] = built
  }

  return withPlanModeReminders(tools, planContext)
}

/**
 * The session's current approvals, read from the (sub-)session that owns the
 * turn and falls back to the snapshot the caller loaded when there is no ctx.
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

type BuildContext = {
  manifest: ToolManifest
  mcpByName: Map<string, McpManifestEntry>
  resources: ToolResources
  workspace?: WorkspaceToolContext
  planContext?: PlanToolContext
}

/** Constructs one tool by its cached name. */
async function createManifestTool(
  name: string,
  build: BuildContext,
): Promise<AnyTool | undefined> {
  const { workspace, planContext } = build

  switch (name) {
    case 'web_fetch':
      return createWebFetchTool()
    case 'web_search':
      return createWebSearchTool(build.resources.settings)
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
    case TASK_TOOL_NAME:
      return createTaskTool(build.manifest.taskRoster ?? '')
  }

  const entry = build.mcpByName.get(name)
  if (!entry) return undefined
  return createExternalMcpTool(entry, build.resources.mcpServers)
}
