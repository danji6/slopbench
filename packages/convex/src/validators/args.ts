import { v } from 'convex/values'

import {
  agentAutoApproveValidator,
  agentSubAgentsValidator,
  mcpToolMetaValidator,
  mcpTransportValidator,
  modelEntryValidator,
  overridableFields,
  promptItemValidator,
  promptOrderRefValidator,
  promptScopeValidator,
  rememberScopeValidator,
  reminderPromptValidator,
  reminderScopeValidator,
  roleValidator,
  sessionArchiveValidator,
  sessionModeValidator,
  sessionSettingsValidator,
  settingsMutableFields,
  shellJobStatusValidator,
  tokenUsageValidator,
  toolManifestValidator,
} from './sub'

export const saveSessionCacheArgsValidator = v.object({
  sessionId: v.id('sessions'),
  agentId: v.id('agents'),
  items: v.optional(v.array(promptItemValidator)),
  tools: v.optional(toolManifestValidator),
})

const workspaceTextLinkValidator = v.object({
  kind: v.literal('text'),
  path: v.string(),
  content: v.string(),
  truncated: v.boolean(),
})

const workspaceDirectoryLinkValidator = v.object({
  kind: v.literal('directory'),
  path: v.string(),
  entries: v.array(v.string()),
  truncated: v.boolean(),
})

const workspaceBinaryRefLinkValidator = v.object({
  kind: v.literal('binary-ref'),
  path: v.string(),
  storageId: v.id('_storage'),
  mediaType: v.string(),
  filename: v.string(),
})

const workspaceSkippedLinkValidator = v.object({
  kind: v.literal('skipped'),
  path: v.string(),
  reason: v.string(),
})

export const workspaceSnapshotValidator = v.union(
  workspaceTextLinkValidator,
  workspaceDirectoryLinkValidator,
  workspaceBinaryRefLinkValidator,
  workspaceSkippedLinkValidator,
)

export const sendMessageArgsValidator = v.object({
  sessionId: v.id('sessions'),
  content: v.string(),
  role: v.optional(roleValidator),
  silent: v.optional(v.boolean()), // skips agent invocation (and eventually, notifications)
  attachments: v.optional(
    v.array(
      v.object({
        id: v.id('attachments'),
        data: v.optional(v.string()), // used for client optimistic updates
      }),
    ),
  ),
  fileLinks: v.optional(
    v.array(
      v.object({
        path: v.string(),
        snapshot: v.optional(workspaceSnapshotValidator),
      }),
    ),
  ),
})

export const agentMutableFieldsValidator = {
  description: v.optional(v.string()),
  tools: v.optional(v.array(v.string())),
  globalPromptsEnabled: v.optional(v.boolean()),
  libraryReminderIds: v.optional(v.array(v.string())),
  promptOrder: v.optional(v.array(promptOrderRefValidator)),
  modelId: v.optional(v.string()),
  reasoningEffort: v.optional(v.string()),
  temperature: v.optional(v.number()),
  topP: v.optional(v.number()),
  frequencyPenalty: v.optional(v.number()),
  presencePenalty: v.optional(v.number()),
  repeatPenalty: v.optional(v.number()),
  trimContext: v.optional(v.boolean()),
  contextWindow: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  shareUserDisplayNames: v.optional(v.boolean()),
  shareAgentDisplayNames: v.optional(v.boolean()),
  maskOtherAgents: v.optional(v.boolean()),
  autoApprove: v.optional(agentAutoApproveValidator),
  subAgents: v.optional(agentSubAgentsValidator),
  ...overridableFields,
}

export const createAgentArgsValidator = v.object({
  name: v.string(),
  prompts: v.optional(v.array(promptItemValidator)),
  reminderPrompts: v.optional(v.array(reminderPromptValidator)),
  ...agentMutableFieldsValidator,
})

/**
 * The agent field that was requested to be cleared. Needed because Convex
 * drops `undefined` from a patch.
 */
export const agentKeyValidator = v.union(
  ...(
    Object.keys(
      agentMutableFieldsValidator,
    ) as (keyof typeof agentMutableFieldsValidator)[]
  ).map((key) => v.literal(key)),
)

export const updateAgentArgsValidator = v.object({
  agentId: v.id('agents'),
  name: v.optional(v.string()),
  /** Field names whose values should be cleared. */
  unset: v.optional(v.array(agentKeyValidator)),
  ...agentMutableFieldsValidator,
})

export const settingsPatchArgsValidator = v.object(settingsMutableFields)

/**
 * The settings field that was requested to be cleared. Needed because Convex
 * drops `undefined` from a patch.
 */
export const settingsKeyValidator = v.union(
  ...(
    Object.keys(settingsMutableFields) as (keyof typeof settingsMutableFields)[]
  ).map((key) => v.literal(key)),
)

export const createPromptArgsValidator = v.object({
  scope: promptScopeValidator,
  agentId: v.optional(v.id('agents')),
  item: promptItemValidator,
  index: v.optional(v.number()),
})

export const updatePromptArgsValidator = v.object({
  promptId: v.id('prompts'),
  item: promptItemValidator,
})

export const reorderPromptsArgsValidator = v.object({
  scope: promptScopeValidator,
  agentId: v.optional(v.id('agents')),
  promptIds: v.array(v.id('prompts')),
})

export const replacePromptScopeArgsValidator = v.object({
  scope: promptScopeValidator,
  agentId: v.optional(v.id('agents')),
  items: v.array(promptItemValidator),
})

export const replaceReminderScopeArgsValidator = v.object({
  scope: reminderScopeValidator,
  agentId: v.optional(v.id('agents')),
  items: v.array(reminderPromptValidator),
})

export const createReminderArgsValidator = v.object({
  scope: reminderScopeValidator,
  agentId: v.optional(v.id('agents')),
  item: reminderPromptValidator,
})

export const updateReminderArgsValidator = v.object({
  reminderId: v.id('reminders'),
  item: reminderPromptValidator,
})

export const replaceMcpServersArgsValidator = v.object({
  servers: v.array(
    v.object({
      key: v.string(),
      label: v.string(),
      url: v.string(),
      transport: mcpTransportValidator,
      enabled: v.boolean(),
      /** Absent leaves the stored credential alone; empty clears it. */
      apiKey: v.optional(v.string()),
      /** Absent keeps the tools already discovered for this server. */
      tools: v.optional(v.array(mcpToolMetaValidator)),
    }),
  ),
})

export const discoverMcpToolsArgsValidator = v.object({
  url: v.string(),
  transport: mcpTransportValidator,
  apiKey: v.optional(v.string()),
  serverId: v.optional(v.id('mcpServers')),
})

export const replaceModelProvidersArgsValidator = v.object({
  providers: v.array(
    v.object({
      key: v.string(),
      baseURL: v.optional(v.string()),
      enabled: v.boolean(),
      models: v.array(modelEntryValidator),
      apiKey: v.optional(v.string()),
    }),
  ),
})

export const createModelProviderArgsValidator = v.object({
  key: v.string(),
  baseURL: v.optional(v.string()),
  enabled: v.boolean(),
  models: v.array(modelEntryValidator),
})

export const updateModelProviderArgsValidator = v.object({
  providerId: v.id('modelProviders'),
  baseURL: v.optional(v.string()),
  enabled: v.optional(v.boolean()),
  models: v.optional(v.array(modelEntryValidator)),
})

export const createSessionArgsValidator = v.object({
  activeAgentId: v.optional(v.id('agents')),
  workspaceRoot: v.optional(v.string()),
  /** Only meaningful together with workspaceRoot. */
  mode: v.optional(sessionModeValidator),
})

export const updateSessionArgsValidator = v.object({
  sessionId: v.id('sessions'),
  title: v.optional(v.string()),
  activeAgentId: v.optional(v.union(v.id('agents'), v.null())),
  settings: v.optional(sessionSettingsValidator),
})

export const confirmAttachmentArgsValidator = v.object({
  storageId: v.id('_storage'),
  previewStorageId: v.optional(v.id('_storage')),
  sessionId: v.id('sessions'),
  filename: v.string(),
  mediaType: v.string(),
})

export const createGeneratedAttachmentArgsValidator = v.object({
  streamId: v.id('streams'),
  messageId: v.id('messages'),
  sessionId: v.id('sessions'),
  uploaderId: v.id('users'),
  storageId: v.id('_storage'),
  filename: v.string(),
  mediaType: v.string(),
})

export const saveStreamMetaArgsValidator = v.object({
  streamId: v.id('streams'),
  duration: v.number(),
  toolErrors: v.array(v.string()),
  warnings: v.array(v.string()),
  usage: tokenUsageValidator,
})

export const scheduleStreamRetryArgsValidator = v.object({
  streamId: v.id('streams'),
  retryAt: v.number(),
  retryError: v.string(),
})

export const createScriptArgsValidator = v.object({
  name: v.string(),
  code: v.string(),
  icon: v.optional(v.string()),
  pinned: v.optional(v.boolean()),
  order: v.optional(v.number()),
})

export const updateScriptArgsValidator = v.object({
  scriptId: v.id('editorScripts'),
  name: v.optional(v.string()),
  code: v.optional(v.string()),
  icon: v.optional(v.string()),
  pinned: v.optional(v.boolean()),
  order: v.optional(v.number()),
})

export const terminalWriteArgsValidator = v.object({
  sessionId: v.id('sessions'),
  jobId: v.string(),
  data: v.string(),
})

export const terminalKillArgsValidator = v.object({
  sessionId: v.id('sessions'),
  jobId: v.string(),
})

export const terminalResizeArgsValidator = v.object({
  sessionId: v.id('sessions'),
  jobId: v.string(),
  cols: v.number(),
  rows: v.number(),
})

export const terminalSessionArgsValidator = v.object({
  sessionId: v.id('sessions'),
})

export const terminalPollArgsValidator = v.object({
  sessionId: v.id('sessions'),
  jobId: v.string(),
  offset: v.number(),
})

/** Mirrors `ShellToolOutput` from `@sb/core/types/tools`. */
export const shellToolOutputValidator = v.object({
  jobId: v.string(),
  status: shellJobStatusValidator,
  exitCode: v.union(v.number(), v.null()),
  text: v.string(),
  term: v.string(),
  termOffset: v.number(),
  waiting: v.optional(v.boolean()),
})

export const userShellPatchArgsValidator = v.object({
  messageId: v.id('messages'),
  toolCallId: v.string(),
  output: shellToolOutputValidator,
})

export const userShellFinishArgsValidator = v.object({
  messageId: v.id('messages'),
  toolCallId: v.string(),
  invokedBy: v.id('users'),
  silent: v.boolean(),
  duration: v.number(),
  output: v.optional(shellToolOutputValidator),
  errorText: v.optional(v.string()),
})

export const shellJobRegisterArgsValidator = v.object({
  sessionId: v.id('sessions'),
  agentId: v.id('agents'),
  invokedBy: v.id('users'),
  jobId: v.string(),
  command: v.string(),
  toolCallId: v.string(),
})

export const shellJobUserKillArgsValidator = v.object({
  sessionId: v.id('sessions'),
  jobId: v.string(),
})

export const shellJobSessionArgsValidator = v.object({
  sessionId: v.id('sessions'),
})

export const shellJobCarryArgsValidator = v.object({
  shellJobId: v.id('shellJobs'),
  term: v.string(),
  termOffset: v.number(),
})

export const shellJobReportArgsValidator = v.object({
  shellJobId: v.id('shellJobs'),
  output: v.optional(shellToolOutputValidator),
  errorText: v.optional(v.string()),
})

export const messagesWindowArgsValidator = v.object({
  sessionId: v.id('sessions'),
  /**
   * A `by_sessionId` index key (sessionId, _creationTime, _id).
   * When null, it anchors at the newest message (see `WindowAnchor` for the type).
   */
  anchor: v.union(v.array(v.union(v.string(), v.number())), v.null()),
  direction: v.union(v.literal('older'), v.literal('newer')),
  limit: v.number(),
  /** Content budget for the page. A message count fallback is used when absent. */
  budgetBytes: v.optional(v.number()),
  /**
   * Bounds the anchor message's segments. Older pages include segments up to
   * it, newer pages from it. Absent means the whole message.
   */
  anchorSegment: v.optional(v.number()),
})

/** Addresses one part within a message's selected version. */
export const partAddressValidator = v.object({
  segmentIndex: v.number(),
  partIndex: v.number(),
})

export const editMessagePartArgsValidator = v.object({
  messageId: v.id('messages'),
  segmentIndex: v.number(),
  partIndex: v.number(),
  text: v.string(),
})

export const deleteMessagePartsArgsValidator = v.object({
  messageId: v.id('messages'),
  addresses: v.array(partAddressValidator),
  from: v.optional(partAddressValidator),
})

export const approveToolArgsValidator = v.object({
  sessionId: v.id('sessions'),
  toolCallId: v.string(),
  approved: v.boolean(),
  reason: v.optional(v.string()),
  remember: v.optional(rememberScopeValidator),
  /** Note from the user, delivered to the agent alongside the response. */
  note: v.optional(v.string()),
})

export const importSessionArgsValidator = v.object({
  payload: sessionArchiveValidator,
  subject: v.string(),
  avatars: v.record(v.string(), v.id('_storage')),
})
