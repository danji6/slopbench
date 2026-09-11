import {
  attachmentRef,
  attachmentReference,
  readUtf8Range,
} from '@sb/core/attachments'
import {
  ATTACHMENT_READ_DEFAULT_BYTES,
  ATTACHMENT_READ_MAX_BYTES,
  READ_ATTACHMENT_TOOL_NAME,
} from '@sb/core/const'
import { TOOL_DESCRIPTIONS, readAttachmentFields } from '@sb/core/types'
import { isKnownTextFile } from '@sb/core/workspace/files'
import type { Tool, ToolSet } from 'ai'

import { internal } from '../../_generated/api'
import type { ActionCtx } from '../../_generated/server'
import { ToolError } from '../../errors'

type TextAttachmentOutput = ReturnType<typeof readUtf8Range> & {
  kind: 'text'
  filename: string
  mediaType: string
}

type MediaAttachmentOutput = {
  kind: 'media' | 'expired-media'
  url: string
  reference: string
  filename: string
  mediaType: string
  byteLength: number
}

type AttachmentOutput = TextAttachmentOutput | MediaAttachmentOutput

type ReadAttachmentInput = {
  reference: string
  offset?: number
  limit?: number
}

export async function createReadAttachmentTool(ctx: ActionCtx) {
  return await Promise.all([import('ai'), import('zod')]).then(
    ([{ tool }, { z }]) =>
      tool<ReadAttachmentInput, AttachmentOutput, never>({
        description: TOOL_DESCRIPTIONS.read_attachment,
        inputSchema: z.object(readAttachmentFields),
        execute: async ({
          reference: inputReference,
          offset = 0,
          limit = ATTACHMENT_READ_DEFAULT_BYTES,
        }) => {
          const reference = attachmentReference(inputReference)
          if (!reference)
            throw new ToolError('Invalid permanent attachment reference')

          const file = await ctx.runQuery(internal.attachments._getSharedFile, {
            token: reference.token,
          })
          if (!file || file.filename !== reference.filename)
            throw new ToolError('Attachment link is invalid or expired')

          if (!isKnownTextFile(file.mediaType, file.filename)) {
            const storageUrl = await ctx.storage.getUrl(file.storageId)
            if (!storageUrl)
              throw new ToolError('Attachment data is no longer available')
            return {
              kind: 'media' as const,
              url: storageUrl,
              reference: attachmentRef(reference.token, reference.filename),
              filename: file.filename,
              mediaType: file.mediaType,
              byteLength: file.byteLength,
            }
          }

          const blob = await ctx.storage.get(file.storageId)
          if (!blob)
            throw new ToolError('Attachment data is no longer available')

          try {
            const bytes = new Uint8Array(await blob.arrayBuffer())
            return {
              kind: 'text' as const,
              filename: file.filename,
              mediaType: file.mediaType,
              ...readUtf8Range(
                bytes,
                offset,
                Math.min(limit, ATTACHMENT_READ_MAX_BYTES),
              ),
            }
          } catch (error) {
            if (error instanceof ToolError) throw error
            throw new ToolError('Attachment is not valid UTF-8 text')
          }
        },
        toModelOutput: attachmentToModelOutput,
      }),
  )
}

export function attachmentToModelOutput({
  output,
}: {
  output: AttachmentOutput
}) {
  if (output.kind === 'media') {
    return {
      type: 'content' as const,
      value: [
        {
          type: 'text' as const,
          text: `Loaded ${output.filename} (${output.mediaType}, ${output.byteLength} bytes) from ${output.reference}`,
        },
        {
          type: 'file' as const,
          data: { type: 'url' as const, url: new URL(output.url) },
          mediaType: output.mediaType,
          filename: output.filename,
        },
      ],
    }
  }
  if (output.kind === 'expired-media') {
    return {
      type: 'text' as const,
      value: `Media attachment ${output.filename} (${output.mediaType}, ${output.byteLength} bytes) is no longer loaded. Read or reattach ${output.reference} to load it again.`,
    }
  }
  return { type: 'json' as const, value: output }
}

/** Tool result mapper used while reconstructing provider history. */
export function attachmentHistoryTools(): ToolSet {
  const mapper = { toModelOutput: attachmentToModelOutput } as unknown as Tool
  return { [READ_ATTACHMENT_TOOL_NAME]: mapper }
}

/** Replaces a settled media output with metadata after its response turn. */
export function expireAttachmentToolPart(part: unknown): unknown {
  if (
    typeof part !== 'object' ||
    part === null ||
    (part as { type?: unknown }).type !== `tool-${READ_ATTACHMENT_TOOL_NAME}` ||
    (part as { state?: unknown }).state !== 'output-available'
  ) {
    return part
  }

  const output = (part as { output?: unknown }).output
  if (
    typeof output !== 'object' ||
    output === null ||
    (output as { kind?: unknown }).kind !== 'media'
  ) {
    return part
  }

  return {
    ...part,
    output: { ...output, kind: 'expired-media' },
  }
}
