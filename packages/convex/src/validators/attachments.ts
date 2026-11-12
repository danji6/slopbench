import { v } from 'convex/values'

export const confirmAttachmentArgsValidator = v.object({
  storageId: v.id('_storage'),
  previewStorageId: v.optional(v.id('_storage')),
  sessionId: v.id('sessions'),
  filename: v.string(),
  mediaType: v.string(),
})

export const createGeneratedAttachmentArgsValidator = v.object({
  generation: v.number(),
  streamId: v.id('streams'),
  messageId: v.id('messages'),
  sessionId: v.id('sessions'),
  uploaderId: v.id('users'),
  storageId: v.id('_storage'),
  filename: v.string(),
  mediaType: v.string(),
})

/** A session attachment referencing a shared file. */
export const attachmentSchema = v.object({
  /** Shared file identity backing this session attachment. */
  fileId: v.id('attachmentFiles'),
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

/** Blob metadata shared by every message reference to the same file. */
export const attachmentFileSchema = v.object({
  storageId: v.id('_storage'),
  previewStorageId: v.optional(v.id('_storage')),
  previewMediaType: v.optional(v.string()),
  filename: v.string(),
  mediaType: v.string(),
  byteLength: v.number(),
  shareToken: v.string(),
})

const attachmentCursorScope = {
  sessionId: v.id('sessions'),
  agentId: v.id('agents'),
  userId: v.id('users'),
}

export const attachmentCursorPosition = v.object({
  position: v.number(),
  line: v.number(),
  done: v.boolean(),
})

export const attachmentCursorSettings = v.object({
  fileId: v.id('attachmentFiles'),
  storageId: v.id('_storage'),
  reference: v.string(),
  pattern: v.optional(v.string()),
  backward: v.boolean(),
  limit: v.number(),
})

export const attachmentCursorSchema = v.object({
  ...attachmentCursorScope,
  ...attachmentCursorSettings.fields,
  ...attachmentCursorPosition.fields,
  operationId: v.string(),
  revision: v.number(),
  expiresAt: v.number(),
})

export const attachmentCursorReceiptSchema = v.object({
  ...attachmentCursorScope,
  messageId: v.id('messages'),
  callId: v.string(),
  request: v.string(),
  operationId: v.string(),
  page: v.string(),
  expiresAt: v.number(),
})

export const attachmentCursorCall = v.object({
  streamId: v.id('streams'),
  generation: v.number(),
  callId: v.string(),
  request: v.string(),
  operationId: v.optional(v.string()),
})

export const saveAttachmentCursorArgs = v.object({
  ...attachmentCursorCall.fields,
  next: attachmentCursorPosition,
  page: v.string(),
  update: v.union(
    v.object({ operationId: v.string(), settings: attachmentCursorSettings }),
    v.object({ revision: v.number() }),
  ),
})
