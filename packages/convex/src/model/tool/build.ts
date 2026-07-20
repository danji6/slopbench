import type { ToolSet } from 'ai'

import type { Doc } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { TASK_TOOL_NAME, sharedSessionId } from '../../lib/subagent'
import { mergeToolApprovals } from '../../lib/tool/approval'
import type { AgentAutoApprove } from '../../types'
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
import type { WebToolSettings } from './settings'
import {
  createKillShellTool,
  createShellOutputTool,
  createShellTool,
} from './shellTools'
import { createTaskTool } from './task'
import { createEditTodoTool, createWriteTodoTool } from './todo'
import { createWebFetchTool, createWebSearchTool } from './web'

export type ToolBuildOptions = {
  ctx?: ActionCtx
  /** The agent's own approvals, merged into the session's. */
  autoApprove?: AgentAutoApprove
}

/**
 * Builds the tool set from a cached manifest, kept stable to prevent provider
 * cache invalidation.
 */
export async function getEnabledTools(
  manifest: ToolManifest,
  session?: Pick<
    Doc<'sessions'>,
    '_id' | 'workspace' | 'toolApprovals' | 'parent'
  >,
  settings?: WebToolSettings,
  options?: ToolBuildOptions,
): Promise<ToolSet> {
  const ctx = options?.ctx
  const sessionId = session ? sharedSessionId(session) : undefined

  const workspace: WorkspaceToolContext | undefined =
    session?.workspace && sessionId
      ? {
          sessionId,
          workspaceId: session.workspace.workspaceId,
          approvals: mergeToolApprovals(
            session.toolApprovals,
            options?.autoApprove,
          ),
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
      settings,
      workspace,
      planContext,
    })
    if (built) tools[name] = built
  }

  return withPlanModeReminders(tools, planContext)
}

type AnyTool = ToolSet[string]

type BuildContext = {
  manifest: ToolManifest
  mcpByName: Map<string, McpManifestEntry>
  settings?: WebToolSettings
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
      return createWebSearchTool(build.settings)
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
  return createExternalMcpTool(entry, build.settings)
}
