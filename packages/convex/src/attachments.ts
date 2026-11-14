import { v } from 'convex/values'

import { internalMutation, internalQuery } from './_generated/server'
import { authMutation, authQuery } from './functions'
import * as Cursors from './model/attachmentCursors'
import * as Transfers from './model/attachmentTransfers'
import * as Attachments from './model/attachments'
import {
  attachmentTransferCall,
  attachmentTransferResult,
} from './validators/attachmentTransfers'
import {
  attachmentCursorCall,
  confirmAttachmentArgsValidator,
  createGeneratedAttachmentArgsValidator,
  saveAttachmentCursorArgs,
} from './validators/attachments'
import { streamExecutionArgsValidator } from './validators/streams'

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

export const _getSharedFile = internalQuery({
  args: { token: v.string() },
  handler: Attachments._getSharedFile,
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

export const _readCursor = internalQuery({
  args: attachmentCursorCall.fields,
  handler: Cursors.read,
})

export const _saveCursor = internalMutation({
  args: saveAttachmentCursorArgs.fields,
  handler: Cursors.save,
})

export const _pruneCursors = internalMutation({
  args: {},
  handler: Cursors.prune,
})

const transferExecution = {
  ...streamExecutionArgsValidator.fields,
  id: v.id('attachmentTransfers'),
}

export const _beginTransfer = internalMutation({
  args: attachmentTransferCall.fields,
  handler: Transfers.begin,
})

export const _assertTransfer = internalQuery({
  args: transferExecution,
  async handler(ctx, { id, ...execution }) {
    await Transfers.requireActive(ctx, id, execution)
    return true
  },
})

export const _finishCopy = internalMutation({
  args: { ...transferExecution, result: attachmentTransferResult },
  handler: (ctx, { id, result, ...execution }) =>
    Transfers.finishCopy(ctx, id, execution, result),
})

export const _finishPublish = internalMutation({
  args: {
    ...transferExecution,
    storageId: v.id('_storage'),
    filename: v.string(),
    mediaType: v.string(),
  },
  handler: (ctx, { id, streamId, generation, ...file }) =>
    Transfers.finishPublish(ctx, id, { streamId, generation }, file),
})

export const _getTransfer = internalQuery({
  args: { id: v.id('attachmentTransfers') },
  handler: (ctx, { id }) => ctx.db.get(id),
})

export const _cleanTransfer = internalMutation({
  args: { id: v.id('attachmentTransfers') },
  handler: (ctx, { id }) => Transfers.markCleaned(ctx, id),
})

export const _discardTransferUpload = internalMutation({
  args: { id: v.id('attachmentTransfers'), storageId: v.id('_storage') },
  handler: (ctx, { id, storageId }) =>
    Transfers.discardUpload(ctx, id, storageId),
})

export const _abandonTransfer = internalMutation({
  args: transferExecution,
  handler: (ctx, { id, ...execution }) =>
    Transfers.abandonTransfer(ctx, id, execution),
})
