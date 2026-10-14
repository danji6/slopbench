import { v } from 'convex/values'

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
