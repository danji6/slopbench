'use node'

import { attachmentRef, attachmentReference } from '@cv/core/attachments'
import {
  ATTACHMENT_READ_DEFAULT_BYTES,
  ATTACHMENT_READ_MAX_BYTES,
  READ_ATTACHMENT_TOOL_NAME,
} from '@cv/core/const'
import {
  type ReadAttachmentInput,
  TOOL_DESCRIPTIONS,
  readAttachmentFields,
} from '@cv/core/types'
import { isKnownTextFile } from '@cv/core/workspace/files'
import type { Tool, ToolSet } from 'ai'
import { randomBytes } from 'node:crypto'

import { internal } from '../../_generated/api'
import type { Doc } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { ToolError } from '../../errors'
import type {
  AttachmentCursorCall,
  AttachmentCursorSettings,
  SaveAttachmentCursorArgs,
  StreamExecutionArgs,
} from '../../types'
import { readAttachmentPage } from './attachmentPaging'
import { type AttachmentRanges, attachmentRanges } from './attachmentRanges'
import {
  type AttachmentSearchOutput,
  searchAttachment,
} from './attachmentSearch'

type TextAttachmentOutput = Awaited<ReturnType<typeof readAttachmentPage>> & {
  kind: 'text'
  filename: string
  mediaType: string
  operationId: string
}

type AttachmentPage = TextAttachmentOutput | AttachmentSearchOutput

type MediaAttachmentOutput = {
  kind: 'media' | 'expired-media'
  url: string
  reference: string
  filename: string
  mediaType: string
  byteLength: number
}

type AttachmentOutput =
  TextAttachmentOutput | AttachmentSearchOutput | MediaAttachmentOutput

type AttachmentFile = Pick<
  Doc<'attachmentFiles'>,
  '_id' | 'storageId' | 'filename' | 'mediaType' | 'byteLength'
>

type CallOptions = {
  execution?: StreamExecutionArgs
  callId: string
  signal?: AbortSignal
}

export async function createReadAttachmentTool(
  ctx: ActionCtx,
  execution?: StreamExecutionArgs,
) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool<ReadAttachmentInput, AttachmentOutput, never>({
    description: TOOL_DESCRIPTIONS.read_attachment,
    inputSchema: z.strictObject(readAttachmentFields),
    execute: (input, options) =>
      readAttachment(ctx, input, {
        execution,
        callId: options.toolCallId,
        signal: options.abortSignal,
      }),
    toModelOutput: attachmentToModelOutput,
  })
}

async function readAttachment(
  ctx: ActionCtx,
  input: ReadAttachmentInput,
  options: CallOptions,
) {
  validateInput(input)
  // Media still uses the existing single-call path and does not create an operation.
  const initialFile = input.reference
    ? await findAttachment(ctx, input.reference)
    : undefined
  const isMediaAttachment =
    initialFile &&
    !isKnownTextFile(initialFile.file.mediaType, initialFile.file.filename)
  if (isMediaAttachment) {
    return readAttachmentMedia(
      ctx,
      input,
      initialFile.file,
      initialFile.reference,
    )
  }

  if (!options.execution)
    throw new ToolError('Attachment reading requires an active chat execution')

  const call: AttachmentCursorCall = {
    ...options.execution,
    callId: options.callId,
    request: JSON.stringify([
      initialFile?.reference,
      input.operationId,
      input.pattern,
      input.from,
      input.offset,
      input.limit,
    ]),
    operationId: input.operationId,
  }

  const stored = await ctx.runQuery(internal.attachments._readCursor, call)
  const cursor = stored?.cursor
  const reference = initialFile?.reference ?? cursor?.reference
  if (!reference)
    throw new ToolError('Attachment operation is unavailable or expired')

  const resolved = initialFile ?? (await findAttachment(ctx, reference))
  const attachmentChanged =
    cursor &&
    (cursor.fileId !== resolved.file._id ||
      cursor.storageId !== resolved.file.storageId)
  if (attachmentChanged)
    throw new ToolError('Attachment link is invalid or expired')

  if (stored?.page) return JSON.parse(stored.page) as AttachmentPage

  return readAndSave(ctx, call, resolved, {
    input,
    cursor,
    signal: options.signal,
  })
}

function validateInput(input: ReadAttachmentInput) {
  const { operationId, reference, pattern, from, offset, limit } = input
  if (operationId !== undefined) {
    if (!/^[a-zA-Z0-9_-]{12}$/.test(operationId))
      throw new ToolError('Invalid attachment operation ID')
    const hasNewReadOptions = [reference, pattern, from, offset, limit].some(
      (value) => value !== undefined,
    )
    if (hasNewReadOptions) {
      throw new ToolError(
        'Pass operationId alone to continue an attachment operation',
      )
    }
  } else if (!reference) {
    throw new ToolError('Start an attachment read with reference')
  }
  const offsetWithSearchOrBackwardRead =
    offset !== undefined && (from !== undefined || pattern !== undefined)
  if (offsetWithSearchOrBackwardRead)
    throw new ToolError('Use offset only for forward plain attachment reads')
}

export async function findAttachment(ctx: ActionCtx, value: string) {
  const reference = attachmentReference(value)
  if (!reference) throw new ToolError('Invalid permanent attachment reference')
  const file = await ctx.runQuery(internal.attachments._getSharedFile, {
    token: reference.token,
  })
  if (!file || file.filename !== reference.filename)
    throw new ToolError('Attachment link is invalid or expired')
  return { file, reference: attachmentRef(reference.token, reference.filename) }
}

type ReadOptions = {
  input: ReadAttachmentInput
  cursor?: Doc<'attachmentCursors'>
  signal?: AbortSignal
}

async function readAndSave(
  ctx: ActionCtx,
  call: AttachmentCursorCall,
  resolved: { file: AttachmentFile; reference: string },
  { input, cursor, signal }: ReadOptions,
) {
  const { file, reference } = resolved
  const settings = cursor ?? initialSettings(file, reference, input)
  const operationId =
    cursor?.operationId ?? randomBytes(9).toString('base64url')
  const position =
    cursor?.position ??
    (settings.backward
      ? file.byteLength
      : Math.min(input.offset ?? 0, file.byteLength))
  const url = await ctx.storage.getUrl(file.storageId)
  if (!url) throw new ToolError('Attachment data is no longer available')

  const ranges = attachmentRanges(url, file.byteLength, signal)
  const page = await attachmentPage(ranges, file, {
    ...settings,
    operationId,
    position,
    line: cursor?.line ?? 1,
  })

  signal?.throwIfAborted()

  const update: SaveAttachmentCursorArgs['update'] = cursor
    ? { revision: cursor.revision }
    : { operationId, settings }
  const storedPage = await ctx.runMutation(internal.attachments._saveCursor, {
    ...call,
    update,
    next: page.position,
    page: JSON.stringify(page.output),
  })

  return JSON.parse(storedPage) as AttachmentPage
}

function initialSettings(
  file: AttachmentFile,
  reference: string,
  input: ReadAttachmentInput,
): AttachmentCursorSettings {
  return {
    fileId: file._id,
    storageId: file.storageId,
    reference,
    // Persist the effective pattern so every page uses the same flags.
    pattern: input.pattern === undefined ? undefined : `(?i)${input.pattern}`,
    backward: input.from === 'end',
    limit: Math.min(
      input.limit ?? ATTACHMENT_READ_DEFAULT_BYTES,
      ATTACHMENT_READ_MAX_BYTES,
    ),
  }
}

type PageOptions = AttachmentCursorSettings & {
  operationId: string
  position: number
  line: number
}

async function attachmentPage(
  ranges: AttachmentRanges,
  file: AttachmentFile,
  options: PageOptions,
) {
  const { pattern, position, limit, backward, operationId } = options
  if (pattern !== undefined)
    return searchAttachment(ranges, { ...options, pattern })

  const range = await readAttachmentPage(ranges, position, limit, backward)
  const output: TextAttachmentOutput = {
    kind: 'text',
    filename: file.filename,
    mediaType: file.mediaType,
    operationId,
    ...range,
  }
  return {
    output,
    position: {
      position: backward ? range.offset : range.endOffset,
      line: options.line,
      done: range.done,
    },
  }
}

async function readAttachmentMedia(
  ctx: ActionCtx,
  input: ReadAttachmentInput,
  file: AttachmentFile,
  reference: string,
): Promise<MediaAttachmentOutput> {
  const hasSearchOrPagingOptions =
    input.pattern !== undefined ||
    input.from !== undefined ||
    input.operationId !== undefined
  if (hasSearchOrPagingOptions) {
    throw new ToolError(
      'Attachment search and paging require a UTF-8 text file',
    )
  }

  const url = await ctx.storage.getUrl(file.storageId)
  if (!url) throw new ToolError('Attachment data is no longer available')

  return {
    kind: 'media',
    url,
    reference,
    filename: file.filename,
    mediaType: file.mediaType,
    byteLength: file.byteLength,
  }
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
