import { MCP_TRANSPORTS, SEARCH_ENGINE_IDS } from '@sb/core/types'
import { v } from 'convex/values'

export const senderValidator = v.union(
  v.object({ type: v.literal('user'), id: v.id('users') }),
  v.object({ type: v.literal('agent'), id: v.id('agents') }),
)

/** Resolved theme variables as their hex values. */
export const schemeColorsValidator = v.record(v.string(), v.string())

export const themeSnapshotValidator = v.object({
  source: v.string(),
  light: schemeColorsValidator,
  dark: schemeColorsValidator,
})

/** Who a message was sent as, at send time. */
export const senderIdentityFields = {
  senderName: v.optional(v.string()),
  senderAvatarId: v.optional(v.id('avatars')),
  appearanceId: v.optional(v.id('appearances')),
}

export const messageTypeValidator = v.union(
  v.literal('summary'),
  v.literal('reminder'),
  v.literal('todo'),
  v.literal('workspace'),
  v.literal('command'),
  v.literal('mode'),
)

/** Slash commands the server runs, and may defer while a stream is active. */
export const commandNameValidator = v.union(
  v.literal('compact'),
  v.literal('eval'),
  v.literal('impersonate'),
  v.literal('resume'),
)

/** One command awaiting an idle session, with the chip that announces it. */
export const queuedCommandValidator = v.object({
  name: commandNameValidator,
  argument: v.optional(v.string()),
  invokedBy: v.id('users'),
  messageId: v.id('messages'),
})

export const messageStatusValidator = v.union(
  v.literal('processing'),
  v.literal('done'),
)

/** Mirrors `ShellJobStatus` from `@sb/core/types/tools`. */
export const shellJobStatusValidator = v.union(
  v.literal('running'),
  v.literal('done'),
  v.literal('killed'),
  v.literal('timeout'),
  v.literal('background'),
  v.literal('lost'),
)

export const modelEntryValidator = v.object({
  id: v.string(),
  label: v.optional(v.string()),
  contextWindow: v.optional(v.number()),
})

/** A model provider joined with its credential. */
export const modelProviderValidator = v.object({
  id: v.string(),
  apiKey: v.optional(v.string()),
  baseURL: v.optional(v.string()),
  enabled: v.boolean(),
  models: v.array(modelEntryValidator),
})

export const searchEngineValidator = v.union(
  ...SEARCH_ENGINE_IDS.map((id) => v.literal(id)),
)

export const webSearchInstanceValidator = v.object({
  engine: searchEngineValidator,
  url: v.string(),
})

export const mcpTransportValidator = v.union(
  ...MCP_TRANSPORTS.map((id) => v.literal(id)),
)

export const mcpToolMetaValidator = v.object({
  name: v.string(),
  description: v.optional(v.string()),
  descriptionOverride: v.optional(v.string()),
  inputSchema: v.optional(v.string()),
})

/** An MCP server joined with its tools and credential. */
export const mcpServerValidator = v.object({
  id: v.string(),
  label: v.string(),
  url: v.string(),
  transport: mcpTransportValidator,
  apiKey: v.optional(v.string()),
  enabled: v.boolean(),
  tools: v.optional(v.array(mcpToolMetaValidator)),
})

/** Which set a prompt row belongs to. */
export const promptScopeValidator = v.union(
  v.literal('own'), // an agent's own prompts
  v.literal('global'), // injected into every agent
  v.literal('library'), // referenced by id from `promptOrder`
  v.literal('compaction'),
  v.literal('impersonation'),
)

/** Which set a reminder row belongs to. */
export const reminderScopeValidator = v.union(
  v.literal('own'),
  v.literal('library'),
)

/** Which integration a stored API key belongs to. */
export const credentialScopeValidator = v.union(
  v.literal('provider'),
  v.literal('mcp'),
)

/** Cached metadata for one external MCP tool. */
export const mcpManifestEntryValidator = v.object({
  name: v.string(),
  serverId: v.string(),
  toolName: v.string(),
  description: v.optional(v.string()),
  inputSchema: v.optional(v.string()),
})

/** Cached shape of a session's tool set. */
export const toolManifestValidator = v.object({
  names: v.array(v.string()),
  taskRoster: v.optional(v.string()),
  mcp: v.optional(v.array(mcpManifestEntryValidator)),
})

export const tokenUsageValidator = v.object({
  inputTokens: v.number(),
  outputTokens: v.number(),
  totalTokens: v.number(),
})

export const sessionSettingsValidator = v.object({
  disabled: v.optional(v.boolean()),
  slowModeSeconds: v.optional(v.number()), // TODO use milliseconds
  agentDebounceSeconds: v.optional(v.number()), // TODO use milliseconds
  passiveSend: v.optional(v.boolean()), // invoking the agent requires a modifier
})

/** Prompt interpreter variables for one session. */
export const environmentValidator = v.record(v.string(), v.any())

export const workspaceRefValidator = v.object({
  workspaceId: v.string(),
  label: v.string(),
  path: v.string(),
})

export const toolApprovalsValidator = v.object({
  tools: v.optional(v.array(v.string())), // tool names auto-approved for the whole session
  shell: v.optional(v.array(v.string())), // allowlisted shell command patterns
  paths: v.optional(v.array(v.string())), // allowlisted sensitive paths
})

/** Agent approvals merged into every session's approvals. */
export const agentAutoApproveValidator = v.object({
  tools: v.optional(v.array(v.string())),
  shell: v.optional(v.array(v.string())),
})

/** Which owned agents an agent may spawn as sub-agents. */
export const agentSubAgentsValidator = v.object({
  mode: v.union(v.literal('allow'), v.literal('deny')),
  agentIds: v.array(v.id('agents')),
})

export const messageMetaValidator = v.object({
  duration: v.optional(v.number()),
  toolErrors: v.optional(v.array(v.string())),
  warnings: v.optional(v.array(v.string())),
  usage: v.optional(tokenUsageValidator),
  error: v.optional(v.string()),
})

export const roleValidator = v.union(
  v.literal('assistant'),
  v.literal('user'),
  v.literal('system'),
)

export const promptMessageValidator = v.object({
  role: roleValidator,
  content: v.string(),
})

export const promptValidator = v.object({
  id: v.string(),
  name: v.string(),
  role: roleValidator,
  content: v.string(),
  enabled: v.boolean(),
  visible: v.boolean(),
  starter: v.optional(v.boolean()),
})

export const promptMarkerTypeValidator = v.union(
  v.literal('message-history'),
  v.literal('system-boundary'),
  v.literal('agent-prompts'),
)

export const promptMarkerValidator = v.object({
  type: promptMarkerTypeValidator,
})

export const promptItemValidator = v.union(
  promptValidator,
  promptMarkerValidator,
)

export const promptOrderRefValidator = v.object({
  kind: v.union(v.literal('own'), v.literal('global'), v.literal('library')),
  id: v.string(),
})

export const reminderPromptValidator = v.object({
  id: v.string(),
  name: v.string(),
  role: roleValidator,
  content: v.string(),
  enabled: v.boolean(),
  interval: v.number(), // injected as a hidden message every N logical turns
  eager: v.optional(v.boolean()), // fire on first sight instead of waiting a full interval
})

export const filePartValidator = v.object({
  attachmentId: v.id('attachments'),
  mediaType: v.string(),
  filename: v.optional(v.string()),
})

export const streamErrorValidator = v.object({
  kind: v.union(v.literal('rate-limit'), v.literal('error')),
  message: v.string(),
})

export const streamStatusValidator = v.union(
  v.literal('pending'),
  v.literal('streaming'),
  v.literal('stopping'),
  v.literal('retrying'),
  v.literal('awaiting_approval'),
  v.literal('failed'),
)

/** Marks a session as a sub-agent child of another session's turn. */
export const sessionParentValidator = v.object({
  sessionId: v.id('sessions'),
  streamId: v.id('streams'),
  toolCallId: v.string(),
  agentId: v.id('agents'), // parent agent, for the back-link label
})

export const streamValidator = v.object({
  requestId: v.string(),
  status: streamStatusValidator,
  attempt: v.number(),
  jobId: v.optional(v.id('_scheduled_functions')),
  retryAt: v.optional(v.number()),
  error: v.optional(streamErrorValidator),
  messageType: v.optional(v.string()),
  promptMessageId: v.optional(v.string()),
})

export const sessionModeValidator = v.union(
  v.literal('normal'),
  v.literal('plan'),
  // TODO 'ask'
)

/** How far a queued command got, rendered by its chip. */
export const commandStatusValidator = v.union(
  v.literal('queued'),
  v.literal('ran'),
  v.literal('failed'),
)

export const reminderExtraValidator = v.object({
  id: v.string(),
  name: v.string(),
})

export const workspaceExtraValidator = v.object({
  label: v.optional(v.string()), // absent when the workspace was unbound
})

export const modeExtraValidator = v.object({
  from: sessionModeValidator,
  to: sessionModeValidator,
})

export const commandExtraValidator = v.object({
  name: commandNameValidator,
  argument: v.optional(v.string()),
  status: commandStatusValidator,
  error: v.optional(v.string()),
})

export const messageExtraValidator = v.union(
  reminderExtraValidator,
  workspaceExtraValidator,
  modeExtraValidator,
  commandExtraValidator,
)

export const planStatusValidator = v.union(
  v.literal('draft'),
  v.literal('approved'),
)

export const todoStatusValidator = v.union(
  v.literal('pending'),
  v.literal('in_progress'),
  v.literal('completed'),
)

export const todoItemValidator = v.object({
  content: v.string(),
  status: todoStatusValidator,
})

export const streamOperationValidator = v.union(
  v.literal('invoke'),
  v.literal('compact'),
  v.literal('impersonate'),
  v.literal('retry'),
)

export const scrollModeValidator = v.union(
  v.literal('follow'),
  v.literal('into-view'),
)

export const mathModeValidator = v.union(
  v.literal('off'),
  v.literal('single'),
  v.literal('double'),
)

export const themeValidator = v.union(
  v.literal('light'),
  v.literal('dark'),
  v.literal('system'),
)

export const rememberScopeValidator = v.union(
  v.literal('patterns'),
  v.literal('paths'),
)

export const userRoleValidator = v.union(
  v.literal('user'),
  v.literal('moderator'),
  v.literal('admin'),
)

export const sessionArchiveSenderSnapshotValidator = v.object({
  name: v.string(),
  avatarKey: v.optional(v.string()),
  css: v.optional(v.string()),
  theme: v.optional(themeSnapshotValidator),
})

export const sessionArchiveAvatarValidator = v.object({
  key: v.string(),
  mediaType: v.string(),
  data: v.string(),
})

export const sessionArchiveMessageValidator = v.object({
  role: roleValidator,
  type: v.optional(messageTypeValidator),
  hidden: v.optional(v.boolean()),
  extra: v.optional(messageExtraValidator),
  parts: v.array(v.any()),
  senderSnapshot: v.optional(sessionArchiveSenderSnapshotValidator),
  metadata: v.optional(messageMetaValidator),
})

export const sessionArchiveValidator = v.object({
  version: v.literal(1),
  exportedAt: v.number(),
  avatars: v.optional(v.array(sessionArchiveAvatarValidator)),
  session: v.object({
    title: v.string(),
    messages: v.array(sessionArchiveMessageValidator),
  }),
})

/** Settings that a user configures globally and an agent may override. */
export const overridableFields = {
  scrollMode: v.optional(scrollModeValidator),
  customCss: v.optional(v.string()),
  theme: v.optional(themeSnapshotValidator),
  mathMode: v.optional(mathModeValidator),
  chatWidth: v.optional(v.number()),
}

export const overridableFieldsValidator = v.object(overridableFields)

/**
 * Everything a user may patch on their own settings row.
 * Prompt, reminder, provider and MCP sets live in their own tables.
 */
export const settingsMutableFields = {
  displayName: v.optional(v.string()),
  autoTitle: v.optional(v.boolean()),
  titleModel: v.optional(v.string()),
  invertSend: v.optional(v.boolean()),
  groupBySender: v.optional(v.boolean()),
  avatarSize: v.optional(v.number()),
  webSearchInstances: v.optional(v.array(webSearchInstanceValidator)),
  uiFont: v.optional(v.string()),
  chatFont: v.optional(v.string()),
  monoFont: v.optional(v.string()),
  chatFontSize: v.optional(v.number()),
  ...overridableFields,
  themeMode: v.optional(themeValidator),
  recentModel: v.optional(v.string()),
  recentAgentId: v.optional(v.id('agents')),
  recentReasoning: v.optional(v.string()),
  recentWorkspaces: v.optional(v.array(v.string())),
}
