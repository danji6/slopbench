import { v } from 'convex/values'

import { streamExecutionArgsValidator } from './streams'

export const attachmentTransferKind = v.union(
  v.literal('copy_attachment'),
  v.literal('attach_file'),
)

export const attachmentTransferCall = v.object({
  ...streamExecutionArgsValidator.fields,
  callId: v.string(),
  kind: attachmentTransferKind,
  request: v.string(),
  path: v.optional(v.string()),
})

export const attachmentTransferResult = v.object({
  reference: v.string(),
  path: v.optional(v.string()),
  attachmentId: v.optional(v.id('attachments')),
  filename: v.string(),
  mediaType: v.string(),
  byteLength: v.number(),
})

export const attachmentTransferSchema = v.object({
  ...attachmentTransferCall.fields,
  sessionId: v.id('sessions'),
  rootId: v.id('sessions'),
  contentId: v.id('messageContents'),
  result: v.optional(attachmentTransferResult),
  expiresAt: v.number(),
  cleaned: v.optional(v.boolean()),
})
