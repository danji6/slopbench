import { v } from 'convex/values'

import { rememberScopeValidator } from './approvals'
import { commandExtraValidator } from './commands'
import { tokenUsageValidator } from './providers'
import { sessionModeValidator } from './sessionModes'

export const senderValidator = v.union(
  v.object({ type: v.literal('user'), id: v.id('users') }),
  v.object({ type: v.literal('agent'), id: v.id('agents') }),
)

/** Who a message was sent as, at send time. */
export const senderIdentityFields = {
  senderName: v.optional(v.string()),
  senderAvatarId: v.optional(v.id('avatars')),
}

export const messageTypeValidator = v.union(
  v.literal('summary'),
  v.literal('reminder'),
  v.literal('todo'),
  v.literal('workspace'),
  v.literal('command'),
  v.literal('mode'),
)

export const messageStatusValidator = v.union(
  v.literal('processing'),
  v.literal('done'),
)

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

export const filePartValidator = v.object({
  attachmentId: v.id('attachments'),
  mediaType: v.string(),
  filename: v.optional(v.string()),
})

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

export const shellReportExtraValidator = v.object({
  userKilled: v.optional(v.boolean()),
})

export const messageExtraValidator = v.union(
  reminderExtraValidator,
  workspaceExtraValidator,
  modeExtraValidator,
  commandExtraValidator,
  shellReportExtraValidator,
)

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
  /** Permanent attachment references parsed from URLs in the message. */
  attachmentLinks: v.optional(
    v.array(v.object({ token: v.string(), filename: v.string() })),
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
  childSessionId: v.optional(v.id('sessions')),
  toolCallId: v.string(),
  approved: v.boolean(),
  reason: v.optional(v.string()),
  remember: v.optional(rememberScopeValidator),
  /** Note from the user, delivered to the agent alongside the response. */
  note: v.optional(v.string()),
})

export const userAnswerDraftValidator = v.object({
  questionIndex: v.number(),
  selectedOptionIndices: v.optional(v.array(v.number())),
  customAnswer: v.optional(v.string()),
  note: v.optional(v.string()),
  skipped: v.optional(v.boolean()),
})

export const answerQuestionsArgsValidator = v.object({
  sessionId: v.id('sessions'),
  toolCallId: v.string(),
  answers: v.array(userAnswerDraftValidator),
})

/** A session message and metadata for its selected content version. */
export const messageSchema = v.object({
  sessionId: v.id('sessions'),
  sender: senderValidator,
  role: roleValidator,
  ...senderIdentityFields,
  type: v.optional(messageTypeValidator),
  status: messageStatusValidator,
  contextEligible: v.optional(v.boolean()),
  /** Excluded from search when true. */
  hidden: v.optional(v.boolean()),
  /** Extra payload keyed by `type` (see MessageExtra). */
  extra: v.optional(messageExtraValidator),
  /** Last transcript row represented by a completed summary. */
  summaryBoundaryCreationTime: v.optional(v.number()),
  selectedVersion: v.number(),
  versionCount: v.number(),
  /** Mutable tail while processing; lets history queries skip hot content. */
  activeSegmentIndex: v.optional(v.number()),
  /** Metadata accumulated in a full turn for the selected version. */
  metadata: v.optional(messageMetaValidator),
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
  metadata: v.optional(messageMetaValidator),
  ...senderIdentityFields, // segment 0 only
  searchText: v.optional(v.string()),
})

/** An expiring indication that a user is composing a message. */
export const typingSchema = v.object({
  sessionId: v.id('sessions'),
  userId: v.id('users'),
  expiresAt: v.number(),
})

/** A stored tool output linked to its stream and message. */
export const offloadedOutputSchema = v.object({
  streamId: v.id('streams'),
  messageId: v.id('messages'),
  storageId: v.id('_storage'),
})
