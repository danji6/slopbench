'use node'

import type { UIMessage } from 'ai'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import {
  generatedFileCacheKey,
  generatedFilename,
  isGeneratedFilePart,
  parseDataUrl,
} from '../../model/stream/generatedFiles'
import {
  OFFLOAD_THRESHOLD,
  isOffloadableToolPart,
  makeOutputPreview,
  serializeToolOutput,
} from '../../model/stream/toolOutput'

export type OffloadOptions = {
  toolCache: Map<string, unknown>
  fileCache: Map<string, unknown>
  streamId: Id<'streams'>
  messageId: Id<'messages'>
  sessionId: Id<'sessions'>
  uploaderId: Id<'users'>
}

/** Move heavy inline payloads (tool outputs, generated files) into storage. */
export async function offloadLargeParts(
  ctx: ActionCtx,
  parts: UIMessage['parts'],
  opts: OffloadOptions,
): Promise<UIMessage['parts']> {
  const afterTools = await offloadToolOutputs(
    ctx,
    parts,
    opts.toolCache,
    opts.streamId,
    opts.messageId,
  )
  return offloadGeneratedFiles(ctx, afterTools, opts.fileCache, opts)
}

/**
 * Strip AI-generated images out of the message and store them as attachments,
 * leaving an `attachment:<id>` reference.
 */
export async function offloadGeneratedFiles(
  ctx: ActionCtx,
  parts: UIMessage['parts'],
  cache: Map<string, unknown>,
  opts: Pick<
    OffloadOptions,
    'streamId' | 'messageId' | 'sessionId' | 'uploaderId'
  >,
): Promise<UIMessage['parts']> {
  const result = await Promise.all(
    parts.map(async (part) => {
      if (!isGeneratedFilePart(part)) return part

      const key = generatedFileCacheKey(part.url)
      const cached = cache.get(key)
      if (cached) return cached

      const parsed = parseDataUrl(part.url)
      if (!parsed) return part

      const mediaType = part.mediaType ?? parsed.mediaType
      const filename = part.filename ?? generatedFilename(mediaType, cache.size)

      const storageId = await ctx.storage.store(
        new Blob([parsed.bytes], { type: mediaType }),
      )

      const attachmentId = await ctx.runMutation(
        internal.attachments._createGenerated,
        {
          streamId: opts.streamId,
          messageId: opts.messageId,
          sessionId: opts.sessionId,
          uploaderId: opts.uploaderId,
          storageId,
          mediaType,
          filename,
        },
      )

      const compact = {
        type: 'file' as const,
        url: `attachment:${attachmentId}`,
        attachmentId,
        mediaType,
        filename,
      }
      cache.set(key, compact)
      return compact
    }),
  )
  return result as UIMessage['parts']
}

/** Offload large tool outputs to the storage. */
export async function offloadToolOutputs(
  ctx: ActionCtx,
  parts: UIMessage['parts'],
  cache: Map<string, unknown>,
  streamId: Id<'streams'>,
  messageId: Id<'messages'>,
): Promise<UIMessage['parts']> {
  const result = await Promise.all(
    parts.map(async (part) => {
      if (!isOffloadableToolPart(part)) return part

      const { toolCallId, output } = part as {
        toolCallId: string
        output: unknown
      }

      const cached = cache.get(toolCallId)
      if (cached) return cached

      const serialized = serializeToolOutput(output)
      if (serialized.length <= OFFLOAD_THRESHOLD) return part

      const outputRef = await ctx.storage.store(
        new Blob([serialized], { type: 'application/json' }),
      )

      await ctx.runMutation(internal.streams._trackOffloadedOutput, {
        streamId,
        messageId,
        storageId: outputRef,
      })

      const compact = { ...part, output: makeOutputPreview(output), outputRef }
      cache.set(toolCallId, compact)
      return compact
    }),
  )
  return result as UIMessage['parts']
}
