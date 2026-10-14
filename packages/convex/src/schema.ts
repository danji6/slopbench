import { defineSchema, defineTable } from 'convex/server'

import {
  agentFileOperationSchema,
  agentHomeSchema,
  agentSchema,
  agentSkillSchema,
  attachmentFileSchema,
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
  rateLimitSchema,
  releaseStateSchema,
  reminderSchema,
  scheduledEventSchema,
  sessionAgentSchema,
  sessionCacheSchema,
  sessionFolderSchema,
  sessionSchema,
  sessionShareSchema,
  sessionStateSchema,
  settingsSchema,
  shellJobSchema,
  skillSchema,
  skillUploadSchema,
  streamSchema,
  todoSchema,
  typingSchema,
  userSchema,
  userSessionSchema,
} from './validators'

const schemaValidation = true

// prettier-ignore
export default defineSchema({
  sessionFolders: defineTable(sessionFolderSchema)
    .index('by_ownerId_position', ['ownerId', 'position'])
    .index('by_ownerId_parentId_position', ['ownerId', 'parentId', 'position']),

  sessions: defineTable(sessionSchema)
    .index('by_folderId', ['folderId'])
    .index('by_ownerId', ['ownerId'])
    .index('by_parentSessionId', ['parent.sessionId']),

  sessionState: defineTable(sessionStateSchema)
    .index('by_sessionId', ['sessionId']),

  scheduledEvents: defineTable(scheduledEventSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_dedupeKey', ['sessionId', 'dedupeKey'])
    .index('by_targetStreamId', ['targetStreamId'])
    .index('by_messageId', ['messageId']),

  plans: defineTable(planSchema)
    .index('by_sessionId', ['sessionId']),

  todos: defineTable(todoSchema)
    .index('by_sessionId', ['sessionId']),

  sessionCache: defineTable(sessionCacheSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_agentId', ['sessionId', 'agentId'])
    .index('by_agentId', ['agentId']),

  agentHomes: defineTable(agentHomeSchema)
    .index('by_path', ['path'])
    .index('by_ownerId', ['ownerId']),

  skillUploads: defineTable(skillUploadSchema)
    .index('by_storageId', ['storageId']),

  skills: defineTable(skillSchema)
    .index('by_ownerId_name', ['ownerId', 'name']),

  agentSkills: defineTable(agentSkillSchema)
    .index('by_homeId_name', ['homeId', 'name'])
    .index('by_homeId_skillId', ['homeId', 'skillId'])
    .index('by_skillId', ['skillId']),

  agentFileOperations: defineTable(agentFileOperationSchema)
    .index('by_ownerId', ['ownerId'])
    .index('by_agentId', ['agentId']),

  agents: defineTable(agentSchema)
    .index('by_homeId', ['homeId'])
    .index('by_ownerId_name', ['ownerId', 'name'])
    .index('by_avatarId', ['avatarId']),

  users: defineTable(userSchema)
    .index('by_subject', ['subject']),

  avatars: defineTable(avatarSchema),

  settings: defineTable(settingsSchema)
    .index('by_ownerId', ['ownerId'])
    .index('by_avatarId', ['avatarId']),

  rateLimits: defineTable(rateLimitSchema)
    .index('by_key', ['key'])
    .index('by_expiresAt', ['expiresAt']),

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
    .index('by_sessionId_sender', ['sessionId', 'sender.type', 'sender.id'])
    .index('by_sessionId_status_contextEligible', ['sessionId', 'status', 'contextEligible'])
    .index('by_sessionId_type_status', ['sessionId', 'type', 'status'])
    .index('by_senderAvatarId', ['senderAvatarId'])
    .index('by_sender_status', ['sender.type', 'sender.id', 'status']),

  messageContents: defineTable(messageContentSchema)
    .index('by_messageId_version_segment', ['messageId', 'version', 'segmentIndex'])
    .searchIndex('search_contents', { searchField: 'searchText', filterFields: ['sessionId'] }),

  userSessions: defineTable(userSessionSchema)
    .index('by_folderId', ['folderId'])
    .index('by_user_group_activity', ['userId', 'hidden', 'groupKey', 'lastMessageAt'])
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_userId', ['sessionId', 'userId'])
    .index('by_userId_hidden_lastMessageAt', ['userId', 'hidden', 'lastMessageAt'])
    .searchIndex('search_title', { searchField: 'title', filterFields: ['userId', 'hidden'] }),

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
    .index('by_streamId', ['streamId'])
    .index('by_fileId', ['fileId']),

  attachmentFiles: defineTable(attachmentFileSchema)
    .index('by_storageId', ['storageId'])
    .index('by_shareToken', ['shareToken']),

  offloadedOutputs: defineTable(offloadedOutputSchema)
    .index('by_streamId', ['streamId']),

  shellJobs: defineTable(shellJobSchema)
    .index('by_agentId', ['agentId'])
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_jobId', ['sessionId', 'jobId'])
    .index('by_heartbeatAt', ['heartbeatAt']),
}, { schemaValidation })
