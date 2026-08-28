import { defineSchema, defineTable } from 'convex/server'

import {
  agentSchema,
  appearanceSchema,
  attachmentSchema,
  avatarSchema,
  credentialSchema,
  editorScriptSchema,
  mcpServerSchema,
  mcpToolSchema,
  messageContentSchema,
  messageSchema,
  modelProviderSchema,
  notificationSchema,
  offloadedOutputSchema,
  planSchema,
  promptSchema,
  releaseStateSchema,
  reminderSchema,
  sessionAgentSchema,
  sessionCacheSchema,
  sessionSchema,
  sessionShareSchema,
  sessionStateSchema,
  settingsSchema,
  shellJobSchema,
  streamSchema,
  todoSchema,
  typingSchema,
  userSchema,
  userSessionSchema,
} from './validators'

const schemaValidation = true

// prettier-ignore
export default defineSchema({
  sessions: defineTable(sessionSchema)
    .index('by_ownerId', ['ownerId'])
    .index('by_parentSessionId', ['parent.sessionId']),

  sessionState: defineTable(sessionStateSchema)
    .index('by_sessionId', ['sessionId']),

  plans: defineTable(planSchema)
    .index('by_sessionId', ['sessionId']),

  todos: defineTable(todoSchema)
    .index('by_sessionId', ['sessionId']),

  sessionCache: defineTable(sessionCacheSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_agentId', ['sessionId', 'agentId'])
    .index('by_agentId', ['agentId']),

  agents: defineTable(agentSchema)
    .index('by_ownerId_name', ['ownerId', 'name'])
    .index('by_avatarId', ['avatarId']),

  users: defineTable(userSchema)
    .index('by_subject', ['subject']),

  avatars: defineTable(avatarSchema),

  settings: defineTable(settingsSchema)
    .index('by_ownerId', ['ownerId'])
    .index('by_avatarId', ['avatarId']),

  releaseState: defineTable(releaseStateSchema)
    .index('by_key', ['key']),

  prompts: defineTable(promptSchema)
    .index('by_ownerId_scope_order', ['ownerId', 'scope', 'order'])
    .index('by_agentId_scope_order', ['agentId', 'scope', 'order']),

  reminders: defineTable(reminderSchema)
    .index('by_ownerId_scope_order', ['ownerId', 'scope', 'order'])
    .index('by_agentId_scope_order', ['agentId', 'scope', 'order']),

  mcpServers: defineTable(mcpServerSchema)
    .index('by_ownerId_order', ['ownerId', 'order']),

  mcpTools: defineTable(mcpToolSchema)
    .index('by_serverId_order', ['serverId', 'order']),

  modelProviders: defineTable(modelProviderSchema)
    .index('by_ownerId_order', ['ownerId', 'order']),

  credentials: defineTable(credentialSchema)
    .index('by_ownerId_scope_ref', ['ownerId', 'scope', 'ref']),

  editorScripts: defineTable(editorScriptSchema)
    .index('by_ownerId_order', ['ownerId', 'order']),

  messages: defineTable(messageSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_senderType', ['sessionId', 'sender.type'])
    .index('by_sessionId_status_contextEligible', ['sessionId', 'status', 'contextEligible'])
    .index('by_sessionId_type_status', ['sessionId', 'type', 'status'])
    .index('by_senderAvatarId', ['senderAvatarId']),

  appearances: defineTable(appearanceSchema)
    .index('by_hash', ['hash']),

  messageContents: defineTable(messageContentSchema)
    .index('by_messageId_version_segment', ['messageId', 'version', 'segmentIndex'])
    .searchIndex('search_contents', { searchField: 'searchText', filterFields: ['sessionId'] }),

  userSessions: defineTable(userSessionSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_userId', ['sessionId', 'userId'])
    .index('by_userId_hidden_lastMessageAt', ['userId', 'hidden', 'lastMessageAt'])
    .searchIndex('search_title', { searchField: 'title', filterFields: ['userId'] }),

  notifications: defineTable(notificationSchema)
    .index('by_recipientId_status_readAt', ['recipientId', 'status', 'readAt'])
    .index('by_recipientId_sessionId', ['recipientId', 'sessionId'])
    .index('by_sessionId', ['sessionId']),

  typing: defineTable(typingSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_userId', ['sessionId', 'userId'])
    .index('by_expiresAt', ['expiresAt']),

  sessionShares: defineTable(sessionShareSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_tokenHash', ['tokenHash']),

  sessionAgents: defineTable(sessionAgentSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_agentId', ['sessionId', 'agentId'])
    .index('by_agentId', ['agentId']),

  streams: defineTable(streamSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_leaseExpiresAt', ['leaseExpiresAt'])
    .index('by_agentId', ['agentId'])
    .index('by_invokedBy', ['invokedBy']),

  attachments: defineTable(attachmentSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_messageId', ['messageId'])
    .index('by_streamId', ['streamId']),

  offloadedOutputs: defineTable(offloadedOutputSchema)
    .index('by_streamId', ['streamId']),

  shellJobs: defineTable(shellJobSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_jobId', ['sessionId', 'jobId'])
    .index('by_heartbeatAt', ['heartbeatAt']),
}, { schemaValidation })
