'use node'

import { randomUUID } from 'node:crypto'

import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { ToolError } from '../../errors'
import type { StreamExecutionArgs } from '../../types'
import { type TransferResult, transferTarget } from '../attachmentTransfers'
import { postSidecar } from '../sidecar'
import { findAttachment } from './attachments'

type Operation = Doc<'attachmentTransfers'>

type CopyInput = { reference: string; destination?: string }

type PublishInput = { path: string; filename?: string }

type Invocation = {
  ctx: ActionCtx
  execution: StreamExecutionArgs
  callId: string
  signal?: AbortSignal
}

export async function createAttachmentTransferTool(
  name: Operation['kind'],
  ctx: ActionCtx,
  execution: StreamExecutionArgs,
) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])

  if (name === 'copy_attachment') {
    return tool({
      description:
        'Copy an immutable attachment to a working file. The destination must be a new session:// path. Returns the path for use by local tools.',
      inputSchema: z.strictObject({
        reference: z.string().min(1).describe('Permanent attachment reference'),
        destination: z
          .string()
          .min(1)
          .optional()
          .describe('Full session:// destination file path'),
      }),
      execute: (input, { toolCallId, abortSignal }) =>
        copyAttachment(
          { ctx, execution, callId: toolCallId, signal: abortSignal },
          input,
        ),
    })
  }

  return tool({
    description:
      'Publish a snapshot of a regular session:// file as a downloadable attachment in your response.',
    inputSchema: z.strictObject({
      path: z.string().min(1).describe('The session:// file to publish'),
      filename: z
        .string()
        .min(1)
        .optional()
        .describe('Name displayed on the attachment'),
    }),
    execute: (input, { toolCallId, abortSignal }) =>
      attachFile(
        { ctx, execution, callId: toolCallId, signal: abortSignal },
        input,
      ),
  })
}

async function copyAttachment(
  call: Invocation,
  input: CopyInput,
): Promise<TransferResult> {
  const { ctx, execution, signal } = call
  const { file, reference } = await findAttachment(ctx, input.reference)

  const operation = await begin(
    call,
    'copy_attachment',
    [reference, input.destination],
    input.destination ??
      `session://attachments/${randomUUID()}/${safeFilename(file.filename)}`,
  )
  if (operation.result) return operation.result

  const result = await runTransfer(call, operation, async () => {
    const url = await ctx.storage.getUrl(file.storageId)
    if (!url) throw new ToolError('Attachment data is no longer available')

    const target = transferTarget(operation)
    await postSidecar(
      '/session-files/stage-copy',
      { ...target, url, byteLength: file.byteLength },
      signal,
    )

    signal?.throwIfAborted()

    await ctx.runQuery(internal.attachments._assertTransfer, {
      ...execution,
      id: operation._id,
    })
    await postSidecar('/session-files/commit-copy', target, signal)

    signal?.throwIfAborted()

    return ctx.runMutation(internal.attachments._finishCopy, {
      ...execution,
      id: operation._id,
      result: {
        reference,
        path: operation.path,
        filename: file.filename,
        byteLength: file.byteLength,
        mediaType: file.mediaType,
      },
    })
  })
  // Remove the private hard link before a subsequent tool can publish this file.
  await postSidecar('/session-files/cleanup-transfer', {
    operationId: operation._id,
    discardUpload: false,
  }).catch(() => {})
  return result
}

async function attachFile(
  call: Invocation,
  input: PublishInput,
): Promise<TransferResult> {
  const { ctx, execution, signal } = call

  const operation = await begin(
    call,
    'attach_file',
    [input.path, input.filename],
    input.path,
  )
  if (operation.result) return operation.result

  return runTransfer(call, operation, async () => {
    const url = await ctx.storage.generateUploadUrl()
    const uploaded = await postSidecar<{
      storageId: Id<'_storage'>
      filename: string
      mediaType: string
    }>(
      '/session-files/publish',
      {
        ...transferTarget(operation),
        url,
        filename: input.filename,
      },
      signal,
    )
    signal?.throwIfAborted()
    return ctx.runMutation(internal.attachments._finishPublish, {
      ...execution,
      id: operation._id,
      ...uploaded,
    })
  })
}

async function runTransfer(
  { ctx, execution }: Invocation,
  operation: Operation,
  transfer: () => Promise<TransferResult>,
) {
  try {
    return await transfer()
  } catch (error) {
    await ctx
      .runMutation(internal.attachments._abandonTransfer, {
        ...execution,
        id: operation._id,
      })
      .catch(() => {})
    throw error
  }
}

function begin(
  { ctx, execution, callId }: Invocation,
  kind: Operation['kind'],
  args: unknown[],
  path: string,
) {
  return ctx.runMutation(internal.attachments._beginTransfer, {
    ...execution,
    callId,
    kind,
    request: JSON.stringify(args),
    path,
  })
}

function safeFilename(value: string) {
  const name = value.replace(/[/\\:\p{Cc}]/gu, '_')
  return name.trim() && name !== '.' && name !== '..' ? name : 'attachment'
}
