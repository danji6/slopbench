import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

import * as V from './validators'
import { attachmentTransferSchema } from './validators/attachmentTransfers'
import { sessionFileOperationSchema } from './validators/sessionFiles'

const schemaValidation = true

// prettier-ignore
export default defineSchema({
  toolkits: defineTable(V.toolkitSchema)
    .index('by_ownerId', ['ownerId'])
    .index('by_ownerId_root', ['ownerId', 'root']),

  mcpProtocolChecks: defineTable(V.protocolCheckSchema)
    .index('by_resultRef', ['resultRef'])
    .index('by_ownerId', ['ownerId']),

  sessionFolders: defineTable(V.sessionFolderSchema)
    .index('by_ownerId_position', ['ownerId', 'position'])
    .index('by_ownerId_parentId_position', ['ownerId', 'parentId', 'position'])
    .index('by_owner_parent_pinned_position', ['ownerId', 'parentId', 'pinned', 'position'])
    .index('by_owner_pinned_order', ['ownerId', 'pinned', 'pinnedAt']),

  sessions: defineTable(V.sessionSchema)
    .index('by_folderId', ['folderId'])
    .index('by_ownerId', ['ownerId'])
    .index('by_parentSessionId', ['parent.sessionId']),

  sessionState: defineTable(V.sessionStateSchema)
    .index('by_sessionId', ['sessionId']),

  scheduledEvents: defineTable(V.scheduledEventSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_dedupeKey', ['sessionId', 'dedupeKey'])
    .index('by_targetStreamId', ['targetStreamId'])
    .index('by_messageId', ['messageId']),

  plans: defineTable(V.planSchema)
    .index('by_sessionId', ['sessionId']),

  todos: defineTable(V.todoSchema)
    .index('by_sessionId', ['sessionId']),

  sessionCache: defineTable(V.sessionCacheSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_agentId', ['sessionId', 'agentId'])
    .index('by_agentId', ['agentId']),

  agentHomes: defineTable(V.agentHomeSchema)
    .index('by_path', ['path'])
    .index('by_ownerId', ['ownerId']),

  skillUploads: defineTable(V.skillUploadSchema)
    .index('by_storageId', ['storageId']),

  skills: defineTable(V.skillSchema)
    .index('by_ownerId_name', ['ownerId', 'name']),

  agentSkills: defineTable(V.agentSkillSchema)
    .index('by_homeId_name', ['homeId', 'name'])
    .index('by_homeId_skillId', ['homeId', 'skillId'])
    .index('by_skillId', ['skillId']),

  agentFileOperations: defineTable(V.agentFileOperationSchema)
    .index('by_ownerId', ['ownerId'])
    .index('by_agentId', ['agentId']),

  agents: defineTable(V.agentSchema)
    .index('by_ownerId_lastSelectedAt', ['ownerId', 'lastSelectedAt'])
    .index('by_homeId', ['homeId'])
    .index('by_ownerId_name', ['ownerId', 'name'])
    .index('by_avatarId', ['avatarId']),

  users: defineTable(V.userSchema)
    .index('by_subject', ['subject']),

  avatars: defineTable(V.avatarSchema),

  settings: defineTable(V.settingsSchema)
    .index('by_ownerId', ['ownerId'])
    .index('by_avatarId', ['avatarId']),

  rateLimits: defineTable(V.rateLimitSchema)
    .index('by_key', ['key'])
    .index('by_expiresAt', ['expiresAt']),

  releaseState: defineTable(V.releaseStateSchema)
    .index('by_key', ['key']),

  prompts: defineTable(V.promptSchema)
    .index('by_ownerId_scope_order', ['ownerId', 'scope', 'order'])
    .index('by_agentId_scope_order', ['agentId', 'scope', 'order']),

  reminders: defineTable(V.reminderSchema)
    .index('by_ownerId_scope_order', ['ownerId', 'scope', 'order'])
    .index('by_agentId_scope_order', ['agentId', 'scope', 'order']),

  mcpServers: defineTable(V.mcpServerSchema)
    .index('by_toolkitId', ['toolkitId'])
    .index('by_ownerId_order', ['ownerId', 'order']),

  mcpRuntimes: defineTable(V.mcpRuntimeSchema)
    .index('by_state', ['state'])
    .index('by_ownerId_serverKey', ['ownerId', 'serverKey'])
    .index('by_ownerId', ['ownerId'])
    .index('by_sessionId', ['sessionId'])
    .index('by_agentId', ['agentId'])
    .index('by_sessionId_agentId_serverKey', ['sessionId', 'agentId', 'serverKey']),

  mcpCleanups: defineTable(V.mcpCleanupSchema)
    .index('by_ownerId_serverKey', ['scope.ownerId', 'scope.serverId']),

  mcpOperations: defineTable(V.mcpOperationSchema)
    .index('by_sessionId_agentId', ['sessionId', 'agentId'])
    .index('by_contentId_toolCallId', ['contentId', 'toolCallId'])
    .index('by_streamId_delivered', ['streamId', 'delivered'])
    .index('by_runtimeId_state', ['runtimeId', 'state'])
    .index('by_messageId', ['messageId'])
    .index('by_state_acknowledged', ['state', 'acknowledged']),

  mcpTools: defineTable(V.mcpToolSchema)
    .index('by_serverId_order', ['serverId', 'order']),

  mcpCatalogs: defineTable(V.mcpCatalogSchema)
    .index('by_serverId', ['serverId'])
    .index('by_ownerId', ['ownerId']),

  mcpCatalogTools: defineTable(V.mcpCatalogToolSchema)
    .index('by_catalogId_order', ['catalogId', 'order'])
    .index('by_catalogId_name', ['catalogId', 'name'])
    .index('by_definitionRef', ['definitionRef']),

  mcpCatalogPins: defineTable(V.mcpCatalogPinSchema)
    .index('by_catalogId', ['catalogId'])
    .index('by_cacheId', ['cacheId']),

  mcpBrokerNames: defineTable(V.mcpBrokerNameSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_target', ['sessionId', 'kind', 'target'])
    .index('by_name', ['sessionId', 'kind', 'name']),

  discoveryPreviews: defineTable(V.discoveryPreviewSchema),

  modelCatalog: defineTable(V.catalogRowSchema)
    .index('by_generation', ['generation'])
    .index('by_connection_generation_order', ['connectionId', 'generation', 'order']),

  modelProviders: defineTable(V.modelProviderSchema)
    .index('by_ownerId_order', ['ownerId', 'order']),

  credentials: defineTable(V.credentialSchema)
    .index('by_ownerId_scope_ref', ['ownerId', 'scope', 'ref']),

  editorScripts: defineTable(V.editorScriptSchema)
    .index('by_ownerId_order', ['ownerId', 'order']),

  messages: defineTable(V.messageSchema)
    .index('by_sessionId_contextAnchor', ['sessionId', 'extra.anchorMessageId'])
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_senderType', ['sessionId', 'sender.type'])
    .index('by_sessionId_sender', ['sessionId', 'sender.type', 'sender.id'])
    .index('by_sessionId_status_contextEligible', ['sessionId', 'status', 'contextEligible'])
    .index('by_sessionId_type_status', ['sessionId', 'type', 'status'])
    .index('by_senderAvatarId', ['senderAvatarId'])
    .index('by_sender_status', ['sender.type', 'sender.id', 'status']),

  changeSets: defineTable(V.changeSetSchema)
    .index('by_streamId', ['streamId'])
    .index('by_groupId', ['groupId'])
    .index('by_sessionId', ['sessionId'])
    .index('by_messageId_version', ['messageId', 'version']),

  changeFiles: defineTable(V.changeFileSchema)
    .index('by_changeSetId', ['changeSetId'])
    .index('by_changeSetId_key', ['changeSetId', 'file.key'])
    .index('by_sessionId', ['sessionId']),

  messageContents: defineTable(V.messageContentSchema)
    .index('by_messageId_version_segment', ['messageId', 'version', 'segmentIndex'])
    .searchIndex('search_contents', { searchField: 'searchText', filterFields: ['sessionId'] }),

  userSessions: defineTable(V.userSessionSchema)
    .index('by_folderId', ['folderId'])
    .index('by_user_group_activity', ['userId', 'hidden', 'groupKey', 'lastMessageAt'])
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_userId', ['sessionId', 'userId'])
    .index('by_userId_hidden_lastMessageAt', ['userId', 'hidden', 'lastMessageAt'])
    .searchIndex('search_title', { searchField: 'title', filterFields: ['userId', 'hidden'] }),

  notifications: defineTable(V.notificationSchema)
    .index('by_recipientId_attention', ['recipientId', 'attention', 'requestState'])
    .index('by_requestStreamId', ['request.streamId'])
    .index('by_recipientId_status_readAt', ['recipientId', 'status', 'readAt'])
    .index('by_recipientId_sessionId', ['recipientId', 'sessionId'])
    .index('by_sessionId', ['sessionId']),

  typing: defineTable(V.typingSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_userId', ['sessionId', 'userId'])
    .index('by_expiresAt', ['expiresAt']),

  sessionShares: defineTable(V.sessionShareSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_tokenHash', ['tokenHash']),

  sessionAgents: defineTable(V.sessionAgentSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_agentId', ['sessionId', 'agentId'])
    .index('by_agentId', ['agentId']),

  streams: defineTable(V.streamSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_leaseExpiresAt', ['leaseExpiresAt'])
    .index('by_agentId', ['agentId'])
    .index('by_invokedBy', ['invokedBy']),

  attachments: defineTable(V.attachmentSchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_messageId', ['messageId'])
    .index('by_streamId', ['streamId'])
    .index('by_fileId', ['fileId']),

  attachmentFiles: defineTable(V.attachmentFileSchema)
    .index('by_storageId', ['storageId'])
    .index('by_shareToken', ['shareToken']),

  sessionFileOperations: defineTable(sessionFileOperationSchema)
    .index('by_nextAttemptAt', ['nextAttemptAt']),

  sessionTaskDirectories: defineTable({
    rootId: v.id('sessions'),
    name: v.string(),
  }).index('by_rootId_name', ['rootId', 'name']),

  attachmentTransfers: defineTable(attachmentTransferSchema)
    .index('by_streamId', ['streamId'])
    .index('by_contentId_callId', ['contentId', 'callId'])
    .index('by_cleaned_expiresAt', ['cleaned', 'expiresAt']),

  attachmentCursors: defineTable(V.attachmentCursorSchema)
    .index('by_operationId', ['operationId'])
    .index('by_sessionId', ['sessionId'])
    .index('by_expiresAt', ['expiresAt']),

  attachmentCursorReceipts: defineTable(V.attachmentCursorReceiptSchema)
    .index('by_call', ['messageId', 'callId'])
    .index('by_sessionId', ['sessionId'])
    .index('by_expiresAt', ['expiresAt']),

  offloadedOutputs: defineTable(V.offloadedOutputSchema)
    .index('by_streamId', ['streamId']),

  shellJobs: defineTable(V.shellJobSchema)
    .index('by_agentId', ['agentId'])
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_jobId', ['sessionId', 'jobId'])
    .index('by_heartbeatAt', ['heartbeatAt']),

  shellOutputDeliveries: defineTable(V.shellOutputDeliverySchema)
    .index('by_sessionId', ['sessionId'])
    .index('by_reader_job', ['sessionId', 'agentId', 'workspaceId', 'jobId'])
    .index('by_source', ['messageId', 'version', 'partId']),
}, { schemaValidation })
