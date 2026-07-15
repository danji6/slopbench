import { MCP_TRANSPORTS, SEARCH_ENGINE_IDS } from '@sb/core/types'
import { v } from 'convex/values'

export const senderValidator = v.union(
  v.object({ type: v.literal('user'), id: v.id('users') }),
  v.object({ type: v.literal('agent'), id: v.id('agents') }),
)

// Resolved theme variables as their hex values
export const schemeColorsValidator = v.record(v.string(), v.string())

export const themeSnapshotValidator = v.object({
  source: v.string(),
  light: schemeColorsValidator,
  dark: schemeColorsValidator,
})

export const senderSnapshotValidator = v.object({
  name: v.string(),
  avatarId: v.optional(v.id('avatars')),
  css: v.optional(v.string()),
  theme: v.optional(themeSnapshotValidator),
})

export const messageTypeValidator = v.union(v.literal('summary'))

export const messageStatusValidator = v.union(
  v.literal('processing'),
  v.literal('done'),
)

export const modelEntryValidator = v.object({
  id: v.string(),
  label: v.optional(v.string()),
  contextWindow: v.optional(v.number()),
})

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

export const mcpServerValidator = v.object({
  id: v.string(),
  label: v.string(),
  url: v.string(),
  transport: mcpTransportValidator,
  apiKey: v.optional(v.string()),
  enabled: v.boolean(),
  tools: v.optional(v.array(mcpToolMetaValidator)),
})

export const tokenUsageValidator = v.object({
  inputTokens: v.number(),
  outputTokens: v.number(),
  totalTokens: v.number(),
})

export const sessionMetadataValidator = v.object({
  usage: v.optional(tokenUsageValidator),
  model: v.optional(modelEntryValidator),
  log: v.optional(v.id('_storage')),
})

export const sessionSettingsValidator = v.object({
  disabled: v.optional(v.boolean()),
  slowModeSeconds: v.optional(v.number()), // TODO use milliseconds
  agentDebounceSeconds: v.optional(v.number()), // TODO use milliseconds
  passiveSend: v.optional(v.boolean()), // invoking the agent requires a modifier
})

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
  usage: v.optional(v.any()),
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
  v.literal('agents'),
)

export const promptMarkerValidator = v.object({
  id: v.string(),
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

export const libraryPromptValidator = v.object({
  id: v.string(),
  name: v.string(),
  role: roleValidator,
  content: v.string(),
  enabled: v.boolean(),
  visible: v.boolean(),
  starter: v.optional(v.boolean()),
  createdAt: v.optional(v.number()),
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

export const planStatusValidator = v.union(
  v.literal('draft'),
  v.literal('approved'),
)

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
  compactionPrompts: v.optional(v.array(promptItemValidator)),
  impersonationPrompts: v.optional(v.array(promptItemValidator)),
  planPrompts: v.optional(v.array(promptItemValidator)),
}

export const overridableFieldsValidator = v.object(overridableFields)
