import { v } from 'convex/values'

import { internalMutation, internalQuery } from './_generated/server'
import { authMutation, authQuery } from './functions'
import * as Attachments from './model/attachments'
import {
  confirmAttachmentArgsValidator,
  createGeneratedAttachmentArgsValidator,
} from './validators'

export const generateUploadUrl = authMutation({
  args: {},
  handler: Attachments.generateUploadUrl,
})

export const confirm = authMutation({
  args: confirmAttachmentArgsValidator.fields,
  handler: Attachments.confirm,
})

export const getUrl = authQuery({
  args: { attachmentId: v.id('attachments') },
  handler: Attachments.getUrl,
})

export const get = authQuery({
  args: { attachmentId: v.id('attachments') },
  handler: Attachments.get,
})

export const _get = internalQuery({
  args: { attachmentId: v.id('attachments') },
  handler: Attachments._get,
})

export const _createGenerated = internalMutation({
  args: createGeneratedAttachmentArgsValidator.fields,
  handler: Attachments._createGenerated,
})

export const listBySession = authQuery({
  args: { sessionId: v.id('sessions') },
  handler: Attachments.listBySession,
})

export const remove = authMutation({
  args: { attachmentId: v.id('attachments') },
  handler: Attachments.remove,
})

export const getUrlPair = authQuery({
  args: { attachmentId: v.id('attachments') },
  handler: Attachments.getUrlPair,
})

export const getUrlMap = authQuery({
  args: { ids: v.array(v.id('attachments')) },
  handler: Attachments.getUrlMap,
})

export const pruneOrphans = internalMutation({
  args: {},
  handler: Attachments.pruneOrphans,
})
