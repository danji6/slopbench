import { v } from 'convex/values'

import * as V from './sub'

export const sessionSchema = v.object({
  ownerId: v.id('users'),
  title: v.optional(v.string()),
  activeAgentId: v.optional(v.id('agents')),
  mode: v.optional(V.sessionModeValidator),
  /** Mode the transcript states. */
  announcedMode: v.optional(V.sessionModeValidator),
  settings: v.optional(V.sessionSettingsValidator),
  /** Resolved model of the active agent. */
  model: v.optional(V.modelEntryValidator),
  workspace: v.optional(V.workspaceRefValidator),
  parent: v.optional(V.sessionParentValidator),
  lastMessageAt: v.optional(v.number()),
  lastMessagePreview: v.optional(v.string()),
  /** Title fallback. */
  firstMessagePreview: v.optional(v.string()),
  /** Logical turn counter. */
  turnCount: v.optional(v.number()),
})

/**
 * A session's frequently changing state. It lives outside the session doc
 * because every one of these fields is rewritten during stream turns and would
 * otherwise make client session subscriptions unstable.
 */
export const sessionStateSchema = v.object({
  sessionId: v.id('sessions'),
  environment: v.optional(V.environmentValidator),
  toolApprovals: v.optional(V.toolApprovalsValidator),
  /** (reminderId, turnCount) at last injection, or baseline when first seen. */
  reminderState: v.optional(v.record(v.string(), v.number())),
  /** Deferred (slash) commands. */
  commandQueue: v.optional(v.array(V.queuedCommandValidator)),
  usage: v.optional(V.tokenUsageValidator),
  /** Last provider request/response body. */
  log: v.optional(v.id('_storage')),
  updatedAt: v.number(),
})

export const agentSchema = v.object({
  ownerId: v.id('users'),
  name: v.string(),
  description: v.optional(v.string()),
  avatarId: v.optional(v.id('avatars')),
  promptOrder: v.optional(v.array(V.promptOrderRefValidator)),
  globalPromptsEnabled: v.optional(v.boolean()),
  libraryReminderIds: v.optional(v.array(v.string())),
  modelId: v.optional(v.string()),
  reasoningEffort: v.optional(v.string()),
  /** Names of the selected tools. */
  tools: v.optional(v.array(v.string())),
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
  autoApprove: v.optional(V.agentAutoApproveValidator),
  subAgents: v.optional(V.agentSubAgentsValidator),
  ...V.overridableFields,
})

export const userSchema = v.object({
  subject: v.string(),
  role: V.userRoleValidator,
})

export const settingsSchema = v.object({
  ownerId: v.id('users'),
  avatarId: v.optional(v.id('avatars')),
  ...V.settingsMutableFields,
})

/** A prompt of any kind, kept in a separate table due to its unbounded nature. */
export const promptSchema = v.object({
  ownerId: v.id('users'),
  /** Absent if this prompt lives in the owner's settings. */
  agentId: v.optional(v.id('agents')),
  scope: V.promptScopeValidator,
  order: v.number(),
  /** Corresponds to the id for prompts, and the type for markers. */
  key: v.string(),
  item: V.promptItemValidator,
})

/** Similar to prompts, but injected at configured intervals. */
export const reminderSchema = v.object({
  ownerId: v.id('users'),
  /** Absent if this prompt lives in the owner's settings. */
  agentId: v.optional(v.id('agents')),
  scope: V.reminderScopeValidator,
  order: v.number(),
  key: v.string(),
  item: V.reminderPromptValidator,
})

/** An external MCP server, without its credential or discovered tools. */
export const mcpServerSchema = v.object({
  ownerId: v.id('users'),
  /** Client-generated key, stable across renames. */
  key: v.string(),
  label: v.string(),
  url: v.string(),
  transport: V.mcpTransportValidator,
  enabled: v.boolean(),
  order: v.number(),
})

/** One tool discovered from an external MCP server. */
export const mcpToolSchema = v.object({
  serverId: v.id('mcpServers'),
  name: v.string(),
  description: v.optional(v.string()),
  descriptionOverride: v.optional(v.string()),
  /** The tool's JSON schema, kept as a string to avoid Convex rejections. */
  inputSchema: v.optional(v.string()),
  order: v.number(),
})

/** A model provider, without its credential. */
export const modelProviderSchema = v.object({
  ownerId: v.id('users'),
  /** The provider id, e.g. 'ollama'. */
  key: v.string(),
  baseURL: v.optional(v.string()),
  /** Additional HTTP headers, stored as serialized JSON. */
  extraHeaders: v.optional(v.string()),
  enabled: v.boolean(),
  models: v.array(V.modelEntryValidator),
  order: v.number(),
})

/** An API key, never exposed to clients. */
export const credentialSchema = v.object({
  ownerId: v.id('users'),
  scope: V.credentialScopeValidator,
  /** The provider/server `key` it belongs to. */
  ref: v.string(),
  apiKey: v.string(),
})

/** A message editor script. */
export const editorScriptSchema = v.object({
  name: v.string(),
  ownerId: v.id('users'),
  code: v.string(),
  icon: v.string(),
  pinned: v.boolean(),
  order: v.number(),
})

export const messageSchema = v.object({
  sessionId: v.id('sessions'),
  sender: V.senderValidator,
  role: V.roleValidator,
  ...V.senderIdentityFields,
  type: v.optional(V.messageTypeValidator),
  status: V.messageStatusValidator,
  contextEligible: v.optional(v.boolean()),
  /** Excluded from search when true. */
  hidden: v.optional(v.boolean()),
  /** Extra payload keyed by `type` (see MessageExtra). */
  extra: v.optional(V.messageExtraValidator),
  selectedVersion: v.number(),
  versionCount: v.number(),
  /** Metadata accumulated in a full turn for the selected version. */
  metadata: v.optional(V.messageMetaValidator),
})

/** One segment of a message version's content (split by the byte cap). */
export const messageContentSchema = v.object({
  messageId: v.id('messages'),
  /** Denormalized for the search index filter. */
  sessionId: v.id('sessions'),
  /** The version of this message, starting from 1. */
  version: v.number(),
  /** This segment's index, starting from 0. Gaps allowed after part deletion. */
  segmentIndex: v.number(),
  parts: v.array(v.any()),
  /** This segment's slice of the turn metadata. */
  metadata: v.optional(V.messageMetaValidator),
  ...V.senderIdentityFields, // segment 0 only
  searchText: v.optional(v.string()),
})

/** A message's appearance, identified by the hash of its theme + CSS. */
export const appearanceSchema = v.object({
  hash: v.string(),
  css: v.optional(v.string()),
  theme: v.optional(V.themeSnapshotValidator),
})

export const attachmentSchema = v.object({
  storageId: v.id('_storage'),
  previewStorageId: v.optional(v.id('_storage')),
  uploaderId: v.id('users'),
  sessionId: v.id('sessions'),
  messageId: v.optional(v.id('messages')),
  /** Present when it's a generated image. */
  streamId: v.optional(v.id('streams')),
  filename: v.string(),
  mediaType: v.string(),
})

export const userSessionSchema = v.object({
  sessionId: v.id('sessions'),
  userId: v.id('users'),
  role: v.union(v.literal('owner'), v.literal('member')),
  lastMessageAt: v.optional(v.number()),
  /** This user's last send, for slow mode. */
  lastSendAt: v.optional(v.number()),
  /** Session title denormalized for search. */
  title: v.optional(v.string()),
  /** Always excluded from listing (e.g. sub-agent child sessions). */
  hidden: v.optional(v.boolean()),
  /** True when the user manually hid this session. */
  userHidden: v.optional(v.boolean()),
})

/** A notification with denormalized display snapshots. */
export const notificationSchema = v.object({
  recipientId: v.id('users'),
  sessionId: v.id('sessions'),
  kind: V.notificationKindValidator,
  status: V.notificationStatusValidator,
  readAt: v.optional(v.number()),
  sessionTitle: v.string(),
  actorName: v.string(),
  actorAvatarId: v.optional(v.id('avatars')),
  preview: v.optional(v.string()),
  sourceMessageId: v.optional(v.id('messages')),
})

export const typingSchema = v.object({
  sessionId: v.id('sessions'),
  userId: v.id('users'),
  expiresAt: v.number(),
})

export const sessionShareSchema = v.object({
  sessionId: v.id('sessions'),
  tokenHash: v.string(),
  createdBy: v.id('users'),
  revokedAt: v.optional(v.number()),
})

export const sessionAgentSchema = v.object({
  sessionId: v.id('sessions'),
  agentId: v.id('agents'),
  addedBy: v.id('users'),
})

export const streamSchema = v.object({
  sessionId: v.id('sessions'),
  agentId: v.id('agents'),
  invokedBy: v.id('users'),
  processingMessageId: v.optional(v.id('messages')),
  /** The active segment row. */
  processingContentId: v.optional(v.id('messageContents')),
  contextBoundaryMessageId: v.optional(v.id('messages')),
  contextBoundaryCreationTime: v.optional(v.number()),
  operation: V.streamOperationValidator,
  mode: v.optional(V.sessionModeValidator),
  blocking: v.boolean(),
  status: V.streamStatusValidator,
  attempt: v.number(),
  leaseExpiresAt: v.number(),
  jobId: v.optional(v.id('_scheduled_functions')),
  /** When a pending stream should claim. */
  fireAt: v.optional(v.number()),
  retryAt: v.optional(v.number()),
  retryError: v.optional(v.string()),
  suppressFollowUp: v.optional(v.boolean()),
  /** True for child (sub-agent) streams stopped from above. */
  suppressReport: v.optional(v.boolean()),
  instructions: v.optional(v.string()),
})

/**
 * A background shell job that runs long enough to outlive its tool call,
 * watched until it exits so its agent can be woken with the result.
 */
export const shellJobSchema = v.object({
  /** Session that owns the turn. The report is delivered here. */
  sessionId: v.id('sessions'),
  /** Agent that started it, and the report's sender. */
  agentId: v.id('agents'),
  invokedBy: v.id('users'),
  /** Sidecar job id. */
  jobId: v.string(),
  command: v.string(),
  toolCallId: v.string(),
  startedAt: v.number(),
  /** Refreshed each watcher window. A stale value means nobody is watching. */
  heartbeatAt: v.number(),
  /** Scrollback carried across windows to keep the reader's offsets continuous. */
  term: v.string(),
  termOffset: v.number(),
  /** Whether a user stopped this job. Manual stops don't wake the agent. */
  userKilled: v.optional(v.boolean()),
  /** The running watcher, cancelled on release. */
  watcherId: v.optional(v.id('_scheduled_functions')),
})

export const planSchema = v.object({
  sessionId: v.id('sessions'),
  content: v.string(),
  status: V.planStatusValidator,
  /** Marks the user's edits. */
  dirty: v.optional(v.boolean()),
  updatedAt: v.number(),
})

export const sessionCacheSchema = v.object({
  sessionId: v.id('sessions'),
  agentId: v.id('agents'),
  /** Evaluated invoke prompts for this (session, agent). */
  items: v.array(V.promptItemValidator),
  /** Tool set shape. Their behavior is kept volatile. */
  tools: v.optional(V.toolManifestValidator),
  capturedAt: v.number(),
})

export const todoSchema = v.object({
  sessionId: v.id('sessions'),
  items: v.array(V.todoItemValidator),
  /** Session turnCount at last write or nudge reminder. */
  turnCount: v.number(),
  updatedAt: v.number(),
})

export const avatarSchema = v.object({
  storageId: v.id('_storage'),
  thumbStorageId: v.id('_storage'),
})

export const offloadedOutputSchema = v.object({
  streamId: v.id('streams'),
  messageId: v.id('messages'),
  storageId: v.id('_storage'),
})
