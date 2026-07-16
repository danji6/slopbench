import { v } from 'convex/values'

import {
  agentAutoApproveValidator,
  agentSubAgentsValidator,
  overridableFields,
  promptItemValidator,
  promptOrderRefValidator,
  rememberScopeValidator,
  roleValidator,
  sessionArchiveValidator,
  sessionModeValidator,
  sessionSettingsValidator,
} from './sub'

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

export const workspaceSnapshotValidator = v.union(
  workspaceTextLinkValidator,
  workspaceDirectoryLinkValidator,
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
  prompts: v.optional(v.array(promptItemValidator)),
  tools: v.optional(v.any()),
  globalPromptsEnabled: v.optional(v.boolean()),
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
  ...agentMutableFieldsValidator,
})

export const updateAgentArgsValidator = v.object({
  agentId: v.id('agents'),
  name: v.optional(v.string()),
  // Field names whose values should be cleared.
  // Passing `undefined` wouldn't work because Convex drops them.
  unset: v.optional(v.array(v.string())),
  ...agentMutableFieldsValidator,
})

export const createSessionArgsValidator = v.object({
  activeAgentId: v.optional(v.id('agents')),
  workspaceRoot: v.optional(v.string()),
  // Only meaningful together with workspaceRoot (plan mode needs a workspace)
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
  usage: v.any(),
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

export const messagesWindowArgsValidator = v.object({
  sessionId: v.id('sessions'),
  // When null, it anchors at the newest message (see `WindowAnchor` for the type)
  anchor: v.union(v.array(v.any()), v.null()),
  direction: v.union(v.literal('older'), v.literal('newer')),
  limit: v.number(),
  // Content budget for the page. A message count fallback is used when absent.
  budgetBytes: v.optional(v.number()),
  // Bounds the anchor message's segments: older pages include segments up to
  // it, newer pages from it. Absent means the whole message.
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
  // Expanded server-side across all later parts and segments, so that
  // range deletion works even when newer segments aren't loaded on the client.
  from: v.optional(partAddressValidator),
})

export const approveToolArgsValidator = v.object({
  sessionId: v.id('sessions'),
  toolCallId: v.string(),
  approved: v.boolean(),
  reason: v.optional(v.string()),
  remember: v.optional(rememberScopeValidator),
  // Note from the user, delivered to the agent alongside the response.
  note: v.optional(v.string()),
})

export const importSessionArgsValidator = v.object({
  payload: sessionArchiveValidator,
  subject: v.string(),
  avatars: v.record(v.string(), v.id('_storage')),
})
