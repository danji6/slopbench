import { v } from 'convex/values'

import * as V from './sub'

export const sessionSchema = v.object({
  ownerId: v.id('users'),
  title: v.optional(v.string()),
  activeAgentId: v.optional(v.id('agents')),
  mode: v.optional(V.sessionModeValidator),
  environment: v.optional(v.any()),
  settings: v.optional(V.sessionSettingsValidator),
  metadata: v.optional(V.sessionMetadataValidator),
  workspace: v.optional(V.workspaceRefValidator),
  toolApprovals: v.optional(V.toolApprovalsValidator),
  parent: v.optional(V.sessionParentValidator),
  lastMessageAt: v.optional(v.number()),
  lastMessagePreview: v.optional(v.string()),
  firstMessagePreview: v.optional(v.string()), // title fallback
  turnCount: v.optional(v.number()), // logical turn counter
  // (reminderId, turnCount) at last injection, or baseline when first seen
  reminderState: v.optional(v.record(v.string(), v.number())),
})

export const agentSchema = v.object({
  ownerId: v.id('users'),
  name: v.string(),
  description: v.optional(v.string()),
  avatarId: v.optional(v.id('avatars')),
  prompts: v.array(V.promptItemValidator),
  promptOrder: v.optional(v.array(V.promptOrderRefValidator)),
  globalPromptsEnabled: v.optional(v.boolean()),
  reminderPrompts: v.optional(v.array(V.reminderPromptValidator)),
  globalRemindersEnabled: v.optional(v.boolean()),
  modelId: v.optional(v.string()),
  reasoningEffort: v.optional(v.string()),
  tools: v.optional(v.any()),
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
  displayName: v.optional(v.string()),
  avatarId: v.optional(v.id('avatars')),
  autoTitle: v.optional(v.boolean()),
  titleModel: v.optional(v.string()),
  invertSend: v.optional(v.boolean()),
  groupBySender: v.optional(v.boolean()),
  globalPrompts: v.optional(v.array(V.promptValidator)),
  libraryPrompts: v.optional(v.array(V.libraryPromptValidator)),
  reminderPrompts: v.optional(v.array(V.reminderPromptValidator)),
  modelProviders: v.optional(v.array(V.modelProviderValidator)),
  webSearchInstances: v.optional(v.array(V.webSearchInstanceValidator)),
  mcpServers: v.optional(v.array(V.mcpServerValidator)),
  uiFont: v.optional(v.string()),
  chatFont: v.optional(v.string()),
  monoFont: v.optional(v.string()),
  chatFontSize: v.optional(v.number()),
  ...V.overridableFields,
  themeMode: v.optional(V.themeValidator),
  recentModel: v.optional(v.string()),
  recentAgentId: v.optional(v.id('agents')),
  recentReasoning: v.optional(v.string()),
  recentWorkspaces: v.optional(v.array(v.string())),
})

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
  senderSnapshot: v.optional(V.senderSnapshotValidator),
  type: v.optional(V.messageTypeValidator),
  status: V.messageStatusValidator,
  contextEligible: v.optional(v.boolean()),
  hidden: v.optional(v.boolean()), // excluded from search
  extra: v.optional(v.any()), // extra payload, see MessageExtra in types.ts
  selectedVersion: v.number(),
  versionCount: v.number(),
  metadata: v.optional(V.messageMetaValidator), // whole-turn accumulation for the selected version
})

/** One segment of a message version's content (split by the byte cap). */
export const messageContentSchema = v.object({
  messageId: v.id('messages'),
  sessionId: v.id('sessions'), // denormalized for the search index filter
  version: v.number(), // 1-based
  segmentIndex: v.number(), // 0-based; gaps allowed after part deletion
  parts: v.array(v.any()),
  metadata: v.optional(V.messageMetaValidator), // this segment's slice of the turn metadata
  senderSnapshot: v.optional(V.senderSnapshotValidator), // segment 0 only
  searchText: v.optional(v.string()),
})

export const attachmentSchema = v.object({
  storageId: v.id('_storage'),
  previewStorageId: v.optional(v.id('_storage')),
  uploaderId: v.id('users'),
  sessionId: v.id('sessions'),
  messageId: v.optional(v.id('messages')),
  streamId: v.optional(v.id('streams')), // for resolving generated images
  filename: v.string(),
  mediaType: v.string(),
})

export const userSessionSchema = v.object({
  sessionId: v.id('sessions'),
  userId: v.id('users'),
  role: v.union(v.literal('owner'), v.literal('member')),
  lastMessageAt: v.optional(v.number()),
  lastSendAt: v.optional(v.number()), // this user's last send, for slow mode
  title: v.optional(v.string()), // denormalized for search
  hidden: v.optional(v.boolean()), // true for sub-agent child sessions
  userHidden: v.optional(v.boolean()), // user manually hid this session
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
  processingContentId: v.optional(v.id('messageContents')), // the active segment row
  contextBoundaryMessageId: v.optional(v.id('messages')),
  contextBoundaryCreationTime: v.optional(v.number()),
  operation: V.streamOperationValidator,
  mode: v.optional(V.sessionModeValidator),
  blocking: v.boolean(),
  status: V.streamStatusValidator,
  attempt: v.number(),
  leaseExpiresAt: v.number(),
  jobId: v.optional(v.id('_scheduled_functions')),
  fireAt: v.optional(v.number()), // debounce: when a pending stream should claim
  retryAt: v.optional(v.number()),
  retryError: v.optional(v.string()),
  suppressFollowUp: v.optional(v.boolean()),
  suppressReport: v.optional(v.boolean()), // cascade-stopped child: no report
  instructions: v.optional(v.string()),
})

export const planSchema = v.object({
  sessionId: v.id('sessions'),
  content: v.string(),
  status: V.planStatusValidator,
  dirty: v.optional(v.boolean()), // marks user manual edits
  updatedAt: v.number(),
})

export const todoSchema = v.object({
  sessionId: v.id('sessions'),
  items: v.array(V.todoItemValidator),
  turnCount: v.number(), // session turnCount at last write or nudge
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
