import {
  PLAN_TOOL_TOGGLE,
  TODO_EDIT_STATUSES,
  TODO_TOOL_TOGGLE,
} from '@sb/core/const'
import {
  type McpServer,
  TOOL_DESCRIPTIONS,
  editFileFields,
  mcpToolDescription,
  mcpToolName,
  readFileFields,
  webFetchQuerySchema,
  webSearchQuerySchema,
  writeFileFields,
} from '@sb/core/types'
import type { ToolSet } from 'ai'

import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { ActionCtx } from '../_generated/server'
import { ToolError, extractErrorMessage, toolFailure } from '../errors'
import type { AuthQueryCtx } from '../functions'
import { minRole } from '../lib/roles'
import { TASK_TOOL_NAME, sharedSessionId } from '../lib/subagent'
import {
  commandReferencesForbiddenPath,
  extractPathCandidates,
  isPathAllowed,
  isPathForbidden,
  isReadOnlyShellCommand,
  isToolAutoApproved,
  mergeToolApprovals,
} from '../lib/tool/approval'
import type { AgentAutoApprove, ToolApprovals } from '../types'
import type { ShellToolOutput } from '../types'
import { getOrDefault as getSettings } from './settings'
import type { McpManifestEntry, ToolManifest } from './tool/manifest'
import {
  type WebToolSettings,
  enabledMcpServers,
  normalizeWebSearchInstances,
} from './tool/settings'
import {
  type ShellJobInput,
  type ShellOutputInput,
  executeShellJob,
  executeShellOutput,
  killShell,
  shellToModelOutput,
} from './tool/shell'

const DEFAULT_SIDECAR_URL = 'http://localhost:3212'

type WorkspaceToolContext = {
  sessionId: Id<'sessions'>
  workspaceId: string
  approvals?: ToolApprovals
  isPlanMode?: () => Promise<boolean>
}

type PlanToolContext = {
  ctx: ActionCtx
  sessionId: Id<'sessions'>
}

type ToolMeta = {
  name: string
  description?: string
  category?: string
  requiresAdmin?: boolean
  requiresWorkspace?: boolean
}

/** These are what the user sees in the UI */
export const TOOL_METAS = [
  {
    name: 'web_fetch',
    description:
      'Fetch a web page and return its main content as clean markdown.',
    category: 'web',
  },
  {
    name: 'web_search',
    description: 'Search the web through configured search engine instances.',
    category: 'web',
  },
  {
    name: 'read_file',
    description: 'Read files.',
    category: 'workspace',
    requiresAdmin: true,
    requiresWorkspace: true,
  },
  {
    name: 'write_file',
    description: 'Create or overwrite files.',
    category: 'workspace',
    requiresAdmin: true,
    requiresWorkspace: true,
  },
  {
    name: 'edit_file',
    description: 'Edit files.',
    category: 'workspace',
    requiresAdmin: true,
    requiresWorkspace: true,
  },
  {
    name: 'shell',
    description: 'Run shell commands using bash.',
    category: 'workspace',
    requiresAdmin: true,
    requiresWorkspace: true,
  },
  {
    name: TODO_TOOL_TOGGLE,
    description: 'Track multi-step work with a todo list.',
  },
  {
    name: PLAN_TOOL_TOGGLE,
    description: 'Research and author implementation plans before editing.',
    requiresAdmin: true,
  },
] as const

export type ToolName = (typeof TOOL_METAS)[number]['name']

export function getMcpUrl(
  sidecarUrl = process.env.SIDECAR_URL ?? DEFAULT_SIDECAR_URL,
): string {
  const url = new URL(sidecarUrl)
  const pathname = url.pathname.replace(/\/$/, '')
  url.pathname = pathname.endsWith('/mcp') ? pathname : `${pathname}/mcp`
  return url.toString()
}

/** Absolute URL for a sidecar route. */
export function getSidecarUrl(
  path: string,
  sidecarUrl = process.env.SIDECAR_URL ?? DEFAULT_SIDECAR_URL,
): string {
  return new URL(path, sidecarUrl).toString()
}

async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  let closeClient: (() => Promise<void>) | undefined

  try {
    const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
    ])

    const client = new Client({ name: 'convex', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(getMcpUrl()))

    closeClient = () => client.close()

    await client.connect(transport)

    const result = await client.callTool({ name, arguments: args }, undefined, {
      signal,
    })
    const content = result.content as Array<{ type: string; text: string }>
    const text = content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n')

    if (result.isError) throw new ToolError(text || 'Tool call failed')

    return text
  } catch (error) {
    // ToolError rethrown here for propagation
    throw error instanceof ToolError
      ? error
      : new ToolError(extractErrorMessage(error))
  } finally {
    try {
      await closeClient?.()
    } catch {
      // Keep the stream alive, no-op
    }
  }
}

const EMPTY_OBJECT_SCHEMA = { type: 'object' as const, properties: {} }

function parseInputSchema(raw: string | undefined): Record<string, unknown> {
  if (!raw) return EMPTY_OBJECT_SCHEMA
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return EMPTY_OBJECT_SCHEMA
  }
}

async function callExternalMcpTool(
  server: McpServer,
  name: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<string> {
  try {
    const response = await fetch(getSidecarUrl('/mcp-ext/call'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: server.url,
        transport: server.transport,
        apiKey: server.apiKey,
        name,
        args,
      }),
      signal,
    })

    const data = (await response.json()) as { text?: string; error?: string }
    if (!response.ok || data.error) {
      throw new ToolError(data.error ?? `HTTP ${response.status}`)
    }
    return data.text ?? ''
  } catch (error) {
    toolFailure(error)
  }
}

async function createExternalMcpTool(
  entry: McpManifestEntry,
  settings?: WebToolSettings,
) {
  const { tool, jsonSchema } = await import('ai')
  const schema = parseInputSchema(entry.inputSchema) as Parameters<
    typeof jsonSchema
  >[0]
  return tool({
    description: entry.description,
    inputSchema: jsonSchema(schema),
    execute: async (args, { abortSignal }) => {
      const server = enabledMcpServers(settings).find(
        (candidate) => candidate.id === entry.serverId,
      )
      if (!server) {
        throw new ToolError(
          `The MCP server providing "${entry.name}" is no longer configured.`,
        )
      }
      return callExternalMcpTool(server, entry.toolName, args, abortSignal)
    },
  })
}

async function createWebFetchTool() {
  const { tool } = await import('ai')
  return tool({
    description: TOOL_DESCRIPTIONS.web_fetch,
    inputSchema: webFetchQuerySchema,
    execute: (input, { abortSignal }) =>
      callMcpTool('web_fetch', input, abortSignal),
  })
}

async function createWebSearchTool(settings?: WebToolSettings) {
  const { tool } = await import('ai')
  return tool({
    description: TOOL_DESCRIPTIONS.web_search,
    inputSchema: webSearchQuerySchema,
    execute: (input, { abortSignal }) => {
      const instances = normalizeWebSearchInstances(
        settings?.webSearchInstances,
      )
      if (instances.length === 0) {
        throw new ToolError('Web search is not configured.')
      }
      return callMcpTool('web_search', { ...input, instances }, abortSignal)
    },
  })
}

function workspaceArgs(context: WorkspaceToolContext) {
  return {
    sessionId: context.sessionId,
    workspaceId: context.workspaceId,
  }
}

async function createReadFileTool(context: WorkspaceToolContext) {
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

async function createWriteFileTool(context: WorkspaceToolContext) {
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

async function createEditFileTool(context: WorkspaceToolContext) {
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

async function createShellTool(context: WorkspaceToolContext) {
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

async function createShellOutputTool(context: WorkspaceToolContext) {
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

async function createKillShellTool(context: WorkspaceToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool({
    description: TOOL_DESCRIPTIONS.kill_shell,
    inputSchema: z.object({
      jobId: z.string().describe('Job id returned by shell'),
    }),
    execute: ({ jobId }) => killShell(workspaceArgs(context), jobId),
  })
}

async function createWritePlanTool(context: PlanToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool({
    description: TOOL_DESCRIPTIONS.write_plan,
    inputSchema: z.object({
      content: z.string().describe('Complete plan content (markdown)'),
    }),
    execute: async ({ content }) => {
      await context.ctx.runMutation(internal.plans._write, {
        sessionId: context.sessionId,
        content,
      })
      return 'Plan saved.'
    },
  })
}

async function createEditPlanTool(context: PlanToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool({
    description: TOOL_DESCRIPTIONS.edit_plan,
    inputSchema: z.object({ edits: editFileFields.edits }),
    execute: async ({ edits }) => {
      const result = await context.ctx.runMutation(internal.plans._edit, {
        sessionId: context.sessionId,
        edits,
      })
      if (!result.ok) throw new ToolError(result.error)
      return 'Plan updated.'
    },
  })
}

async function createWriteTodoTool(context: PlanToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool({
    description: TOOL_DESCRIPTIONS.write_todo,
    inputSchema: z.object({
      todos: z
        .array(z.string().min(1))
        .describe('Every task as a short string; replaces the previous list'),
    }),
    execute: async ({ todos }) => {
      await context.ctx.runMutation(internal.todos._write, {
        sessionId: context.sessionId,
        todos,
      })
      return todos.length === 0 ? 'Todos cleared.' : 'Todos updated.'
    },
  })
}

async function createEditTodoTool(context: PlanToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool({
    description: TOOL_DESCRIPTIONS.edit_todo,
    inputSchema: z.object({
      edits: z.array(
        z.object({
          task: z.string().describe('Exact text of an existing task'),
          status: z.enum(['todo', 'doing', 'done']),
        }),
      ),
    }),
    execute: async ({ edits }) => {
      const result = await context.ctx.runMutation(internal.todos._edit, {
        sessionId: context.sessionId,
        edits: edits.map(({ task, status }) => ({
          task,
          status: TODO_EDIT_STATUSES[status],
        })),
      })
      if (!result.ok) throw new ToolError(result.error)
      return 'Todos updated.'
    },
  })
}

async function createEnterPlanModeTool(context: PlanToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  const planMode = () => isPlanMode(context.ctx, context.sessionId)

  return tool({
    description: TOOL_DESCRIPTIONS.enter_plan_mode,
    inputSchema: z.object({}),
    // Entering an already active plan mode is a no-op
    needsApproval: async () => !(await planMode()),
    execute: async () =>
      (await planMode())
        ? 'Plan mode is active. Research the task and author a plan with write_plan, then present it with exit_plan_mode.'
        : 'Plan mode is already active for this session.',
  })
}

async function createExitPlanModeTool(context: PlanToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  const getPlan = () =>
    context.ctx.runQuery(internal.plans._get, { sessionId: context.sessionId })

  return tool({
    description: TOOL_DESCRIPTIONS.exit_plan_mode,
    inputSchema: z.object({}),
    needsApproval: async () => {
      const plan = await getPlan()
      return !!plan?.content.trim() && plan.status !== 'approved'
    },
    execute: async () => {
      const plan = await getPlan()
      if (!plan?.content.trim()) {
        throw new ToolError(
          'No plan exists yet. Create one with write_plan first.',
        )
      }
      return `The plan was approved. Here is the approved plan:\n\n${plan.content}\n\nPlan mode is over, proceed with the implementation.`
    },
  })
}

/**
 * Delegates a task to a spawnable sub-agent. The engine spawns a hidden
 * background child session and settles the tool part with a started
 * acknowledgment, and the child's report arrives later as its own
 * message in the parent session (see model/stream/subagents.ts).
 */
async function createTaskTool(roster: string) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])

  return tool({
    description: `${TOOL_DESCRIPTIONS.task}\n\nAvailable agents:\n${roster}`,
    inputSchema: z.object({
      agent_name: z.string().describe('Name of the agent to delegate to'),
      prompt: z
        .string()
        .describe(
          'Complete standalone task, including what the report must contain',
        ),
      title: z
        .string()
        .optional()
        .describe('Short task title (3-6 words), shown to the user'),
    }),
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

async function isPlanMode(
  ctx: ActionCtx,
  sessionId: Id<'sessions'>,
): Promise<boolean> {
  const mode = await ctx.runQuery(internal.sessions._getMode, { sessionId })
  return mode === 'plan'
}

const PLAN_MODE_REMINDER =
  '<system-reminder>' +
  'Plan mode is active, you CANNOT make any changes. Keep researching and refine the plan.' +
  '</system-reminder>'

/** Tools whose outputs skip the plan mode reminder. */
const REMINDER_EXEMPT_TOOL_NAMES = new Set([
  'write_plan',
  'edit_plan',
  'enter_plan_mode',
  'exit_plan_mode',
  'write_todo',
  'edit_todo',
])

/** Adds the plan mode reminder to tool outputs by wrapping `execute`. */
export function withPlanModeReminders(
  tools: ToolSet,
  context?: PlanToolContext,
): ToolSet {
  if (!context) return tools
  const planMode = () => isPlanMode(context.ctx, context.sessionId)

  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      const execute = definition.execute
      if (REMINDER_EXEMPT_TOOL_NAMES.has(name) || !execute)
        return [name, definition]

      // Streaming tools (shell) must return their async iterable
      // synchronously for the AI SDK to properly handle them
      const decorated = ((input, executionOptions) => {
        const result = execute(input, executionOptions)
        return isAsyncIterable(result)
          ? withReminderOnFinalOutput(result, planMode)
          : withReminderOnOutput(result, planMode)
      }) as typeof execute

      return [name, { ...definition, execute: decorated }]
    }),
  )
}

type PlanModeCheck = () => Promise<boolean>

async function withReminderOnOutput(
  result: unknown,
  planMode: PlanModeCheck,
): Promise<unknown> {
  const output = await result
  if (typeof output !== 'string' || !(await planMode())) return output
  return `${output}\n\n${PLAN_MODE_REMINDER}`
}

/** Adds the plan reminder on the final shell output. */
async function* withReminderOnFinalOutput(
  outputs: AsyncIterable<unknown>,
  planMode: PlanModeCheck,
): AsyncGenerator<unknown> {
  for await (const output of outputs) {
    yield isFinalShellOutput(output) && (await planMode())
      ? { ...output, text: `${output.text}\n\n${PLAN_MODE_REMINDER}` }
      : output
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' && value !== null && Symbol.asyncIterator in value
  )
}

function isFinalShellOutput(output: unknown): output is ShellToolOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    typeof (output as ShellToolOutput).text === 'string' &&
    (output as ShellToolOutput).status !== 'running'
  )
}

export async function listTools(ctx: AuthQueryCtx): Promise<ToolMeta[]> {
  const builtin: ToolMeta[] = minRole(ctx.role, 'admin')
    ? [...TOOL_METAS]
    : TOOL_METAS.filter((t) => !('requiresAdmin' in t && t.requiresAdmin))

  const settings = await getSettings(ctx)
  const external: ToolMeta[] = []
  for (const server of enabledMcpServers(settings)) {
    for (const meta of server.tools ?? []) {
      external.push({
        name: mcpToolName(server, meta.name),
        description: mcpToolDescription(meta),
        category: 'mcp',
      })
    }
  }

  return [...builtin, ...external]
}
