import { defineSchema, defineTable } from 'convex/server'

import {
  agentSchema,
  attachmentSchema,
  avatarSchema,
  editorScriptSchema,
  messageContentSchema,
  messageSchema,
  offloadedOutputSchema,
  planSchema,
  sessionAgentSchema,
  sessionCacheSchema,
  sessionSchema,
  sessionShareSchema,
  settingsSchema,
  streamSchema,
  todoSchema,
  typingSchema,
  userSchema,
  userSessionSchema,
} from './validators'

// prettier-ignore
export default defineSchema({
  sessions: defineTable(sessionSchema)
    .index('by_ownerId', ['ownerId'])
    .index('by_parentSessionId', ['parent.sessionId']),

  plans: defineTable(planSchema)
    .index('by_sessionId', ['sessionId']),

  todos: defineTable(todoSchema)
    .index('by_sessionId', ['sessionId']),

  sessionCache: defineTable(sessionCacheSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_agentId', ['sessionId', 'agentId']),

  agents: defineTable(agentSchema)
    .index('by_ownerId_name', ['ownerId', 'name'])
    .index('by_avatarId', ['avatarId']),

  users: defineTable(userSchema)
    .index('by_subject', ['subject']),

  avatars: defineTable(avatarSchema)
    .index('by_storageId', ['storageId']),

  settings: defineTable(settingsSchema)
    .index('by_ownerId', ['ownerId'])
    .index('by_avatarId', ['avatarId']),

  editorScripts: defineTable(editorScriptSchema)
    .index('by_ownerId_order', ['ownerId', 'order']),

  messages: defineTable(messageSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_senderType', ['sessionId', 'sender.type'])
    .index('by_sessionId_status_contextEligible', ['sessionId', 'status', 'contextEligible'])
    .index('by_sessionId_type_status', ['sessionId', 'type', 'status'])
    .index('by_snapshotAvatarId', ['senderSnapshot.avatarId']),

  messageContents: defineTable(messageContentSchema)
    .index('by_messageId_version_segment', ['messageId', 'version', 'segmentIndex'])
    .searchIndex('search_contents', { searchField: 'searchText', filterFields: ['sessionId'] }),

  userSessions: defineTable(userSessionSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_userId', ['sessionId', 'userId'])
    .index('by_userId', ['userId'])
    .index('by_userId_lastMessageAt', ['userId', 'lastMessageAt'])
    .index('by_userId_hidden_lastMessageAt', ['userId', 'hidden', 'lastMessageAt'])
    .searchIndex('search_title', { searchField: 'title', filterFields: ['userId'] }),

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
    .index('by_sessionId_status', ['sessionId', 'status'])
    .index('by_processingMessageId', ['processingMessageId'])
    .index('by_leaseExpiresAt', ['leaseExpiresAt'])
    .index('by_agentId', ['agentId'])
    .index('by_invokedBy', ['invokedBy']),

  attachments: defineTable(attachmentSchema)
    .index('by_uploaderId', ['uploaderId'])
    .index('by_sessionId', ['sessionId'])
    .index('by_messageId', ['messageId'])
    .index('by_streamId', ['streamId']),

  offloadedOutputs: defineTable(offloadedOutputSchema)
    .index('by_streamId', ['streamId']),
})
