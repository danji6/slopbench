'use node'

import {
  INJECTED_BLOCK_PREFIXES,
  toDirectoryBlock,
  toFileBlock,
  toPlanBlock,
} from '@sb/convex/lib/workspace'
import type {
  WorkspaceBinaryRefLink,
  WorkspaceFileLink,
  WorkspaceSkippedLink,
} from '@sb/core/types/workspace'
import { block } from '@sb/core/utils/blocks'
import { blockPath } from '@sb/core/workspace/blocks'
import {
  MAX_TEXT_SNAPSHOT_CHARS,
  isKnownTextFile,
} from '@sb/core/workspace/files'
import type { ModelMessage, UIMessage } from 'ai'

import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import {
  isSubagentReportPart,
  sharedSessionId,
  toSubagentReportBlock,
} from '../../lib/subagent'
import { trimContextToThreshold } from '../../model/context'
import { encodeBase64 } from '../../model/io/base64'
import type { PlanLinkPart } from '../../model/plans'
import { buildPrompts } from '../../model/prompt/prompts'
import { hasOutputRef } from '../../model/stream/toolOutput'
import type { MessageRole, StreamContext } from '../../types'
import { readWorkspaceFileLink } from '../session/workspace'

/** Reason attached to an approval request that reached history still unanswered. */
const UNRESOLVED_APPROVAL_REASON =
  'This tool call was denied and never ran. Do not retry the same call.'

/** Turns any lingering unanswered approval request into a denied tool result. */
export function denyUnresolvedApprovals(
  parts: UIMessage['parts'],
): UIMessage['parts'] {
  return parts.map((part) => {
    if (!part.type.startsWith('tool-')) return part
    const tool = part as { state?: string; approval?: { id?: string } }
    if (tool.state !== 'approval-requested' || !tool.approval?.id) return part
    return {
      ...tool,
      state: 'output-denied',
      approval: {
        id: tool.approval.id,
        approved: false,
        reason: UNRESOLVED_APPROVAL_REASON,
      },
    } as UIMessage['parts'][number]
  })
}

export async function buildProviderHistory(
  ctx: ActionCtx,
  data: StreamContext,
  remainingPrompts: Parameters<typeof buildPrompts>[0],
) {
  const history = await ctx.runQuery(internal.streams._getProviderHistory, {
    streamId: data.stream._id,
  })

  const messages: UIMessage[] = []
  for (const message of history) {
    const { role, parts } = representMessage(
      message,
      data.agent,
      await resolveParts(ctx, message.parts, data.session),
    )
    messages.push({
      id: message._id,
      role: role as MessageRole,
      parts: denyUnresolvedApprovals(parts),
    })
  }

  const attributed = messages.map((message, index) => ({
    ...message,
    parts: prefixSenderName(message, history[index], data.agent),
  }))
  const approvalNotes = collectApprovalNotes(attributed)

  const [{ convertToModelMessages }, { shellHistoryTools: shellHistoryTools }] =
    await Promise.all([import('ai'), import('../../model/tool/shell')])

  let modelMessages = await convertToModelMessages(attributed, {
    ignoreIncompleteToolCalls: true,
    // Maps shell outputs so replayed history never contains terminal scrollback
    tools: shellHistoryTools(),
  })
  modelMessages = addApprovalNotes(modelMessages, approvalNotes)
  modelMessages = removeOrphanToolCalls(modelMessages)
  modelMessages = buildPrompts(
    remainingPrompts,
    modelMessages,
    (value) => value,
  )

  const { trimContext, contextWindow } = data.agent

  return trimContext && (contextWindow ?? 0) > 0
    ? await trimContextToThreshold(modelMessages, undefined, contextWindow!)
    : modelMessages
}

/** Approval notes keyed by the call they annotate, settled calls only. */
export function collectApprovalNotes(
  messages: UIMessage[],
): Map<string, string> {
  const notes = new Map<string, string>()
  for (const message of messages) {
    for (const part of message.parts) {
      if (!part.type.startsWith('tool-')) continue
      const typed = part as {
        state?: string
        toolCallId?: string
        approval?: { note?: string }
      }
      // Only surface the note once the tool has settled, otherwise it never runs
      if (!typed.state?.startsWith('output-')) continue
      const note = typed.approval?.note?.trim()
      if (note && typed.toolCallId) notes.set(typed.toolCallId, note)
    }
  }
  return notes
}

/** Adds each note on the tool result it annotates. */
export function addApprovalNotes(
  messages: ModelMessage[],
  notes: Map<string, string>,
): ModelMessage[] {
  if (notes.size === 0) return messages

  return messages.map((message) => {
    if (message.role !== 'tool') return message
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== 'tool-result') return part
        const note = notes.get(part.toolCallId)
        const output = part.output
        // Approvable tools that don't emit plain text output can't carry a note for now
        if (!note || (output.type !== 'text' && output.type !== 'error-text')) {
          return part
        }
        return {
          ...part,
          output: {
            ...output,
            value: `${output.value}\n\n${block('user-note', note)}`,
          },
        }
      }),
    }
  })
}

export function removeOrphanToolCalls(
  messages: ModelMessage[],
): ModelMessage[] {
  const sanitized: ModelMessage[] = []
  let segment: ModelMessage[] = []

  for (const message of messages) {
    if (message.role === 'assistant' || message.role === 'tool') {
      segment.push(message)
      continue
    }

    sanitized.push(...sanitizeToolSegment(segment), message)
    segment = []
  }

  sanitized.push(...sanitizeToolSegment(segment))
  return sanitized
}

function sanitizeToolSegment(segment: ModelMessage[]): ModelMessage[] {
  if (segment.length === 0) return []

  const keptCallIds = new Set<string>()
  const keptApprovalIds = new Set<string>()

  const normalized = segment
    .map((message, index): ModelMessage | null => {
      if (message.role === 'assistant') {
        if (typeof message.content === 'string') return message

        const futureResultIds = collectFutureToolResultIds(segment, index)
        const futureApprovalIds = collectFutureApprovalResponseIds(
          segment,
          index,
        )
        const removedCallIds = new Set<string>()

        const content = message.content.filter((part) => {
          if (part.type !== 'tool-call' || part.providerExecuted) return true
          if (
            futureResultIds.has(part.toolCallId) ||
            hasFutureApprovalResponse(
              message.content,
              part.toolCallId,
              futureApprovalIds,
            )
          ) {
            keptCallIds.add(part.toolCallId)
            return true
          }
          removedCallIds.add(part.toolCallId)
          return false
        })

        const withoutRemovedApprovals = content.filter((part) => {
          if (part.type !== 'tool-approval-request') return true
          if (removedCallIds.has(part.toolCallId)) return false
          keptApprovalIds.add(part.approvalId)
          return true
        })

        return withoutRemovedApprovals.length > 0
          ? { ...message, content: withoutRemovedApprovals }
          : null
      }

      if (message.role !== 'tool') return message

      const content = message.content.filter((part) => {
        if (part.type === 'tool-result') {
          return keptCallIds.has(part.toolCallId)
        }
        if (part.type === 'tool-approval-response') {
          return keptApprovalIds.has(part.approvalId)
        }
        return true
      })

      return content.length > 0 ? { ...message, content } : null
    })
    .filter((message): message is ModelMessage => message !== null)

  return normalized
}

function collectFutureToolResultIds(
  segment: ModelMessage[],
  startIndex: number,
): Set<string> {
  const resultIds = new Set<string>()

  for (let index = startIndex + 1; index < segment.length; index++) {
    const message = segment[index]
    if (message.role !== 'tool') continue

    for (const part of message.content) {
      if (part.type === 'tool-result') resultIds.add(part.toolCallId)
    }
  }

  return resultIds
}

function collectFutureApprovalResponseIds(
  segment: ModelMessage[],
  startIndex: number,
): Set<string> {
  const approvalIds = new Set<string>()

  for (let index = startIndex + 1; index < segment.length; index++) {
    const message = segment[index]
    if (message.role !== 'tool') continue

    for (const part of message.content) {
      if (part.type === 'tool-approval-response') {
        approvalIds.add(part.approvalId)
      }
    }
  }

  return approvalIds
}

function hasFutureApprovalResponse(
  content: Extract<ModelMessage, { role: 'assistant' }>['content'],
  toolCallId: string,
  futureApprovalIds: Set<string>,
): boolean {
  if (typeof content === 'string') return false

  return content.some(
    (part) =>
      part.type === 'tool-approval-request' &&
      part.toolCallId === toolCallId &&
      futureApprovalIds.has(part.approvalId),
  )
}

async function resolveParts(
  ctx: ActionCtx,
  parts: unknown[],
  session: Doc<'sessions'>,
) {
  const resolved = await Promise.all(
    parts.map((part) => resolvePart(ctx, part, session)),
  )
  return resolved as UIMessage['parts']
}

async function resolvePart(
  ctx: ActionCtx,
  part: unknown,
  session: Doc<'sessions'>,
) {
  if (hasOutputRef(part)) return resolveOffloadedOutput(ctx, part)
  if (isPlanLinkPart(part)) {
    return { type: 'text' as const, text: toPlanBlock(part.snapshot) }
  }
  if (isSubagentReportPart(part)) {
    return { type: 'text' as const, text: toSubagentReportBlock(part) }
  }
  if (isFileLinkPart(part)) return resolveFileLink(ctx, part, session)
  if (!isAttachmentPart(part)) return part
  if (part.url.startsWith('data:')) return part

  const attachment = await ctx.runQuery(internal.attachments._get, {
    attachmentId: part.attachmentId,
  })
  if (!attachment) return part

  if (isKnownTextFile(attachment.mediaType, attachment.filename)) {
    const blob = await ctx.storage.get(attachment.storageId)
    if (!blob) return part

    const raw = await blob.text()
    const truncated = raw.length > MAX_TEXT_SNAPSHOT_CHARS
    const content = truncated
      ? `${raw.slice(0, MAX_TEXT_SNAPSHOT_CHARS)}\n[truncated]`
      : raw

    return {
      type: 'text' as const,
      text: toFileBlock({
        kind: 'text',
        path: attachment.filename,
        content,
        truncated,
      }),
    }
  }

  const blob = await ctx.storage.get(
    attachment.previewStorageId ?? attachment.storageId,
  )
  if (!blob) return part

  const base64 = encodeBase64(new Uint8Array(await blob.arrayBuffer()))
  const mediaType = attachment.mediaType || 'application/octet-stream'
  return {
    type: 'file' as const,
    url: `data:${mediaType};base64,${base64}`,
    mediaType,
    filename: attachment.filename,
  }
}

async function resolveOffloadedOutput(
  ctx: ActionCtx,
  part: { outputRef: Id<'_storage'> },
) {
  const blob = await ctx.storage.get(part.outputRef)
  if (!blob) return part
  try {
    const output: unknown = JSON.parse(await blob.text())
    return { ...part, output, outputRef: undefined }
  } catch {
    return part
  }
}

async function resolveFileLink(
  ctx: ActionCtx,
  part: { type: 'file-link'; path: string; snapshot?: unknown },
  session: Doc<'sessions'>,
) {
  // Links snapshotted at send time never touch disk again
  const snapshot = part.snapshot
  if (isSkippedLink(snapshot)) {
    return skippedFileLink(snapshot.path, snapshot.reason)
  }
  if (isBinaryRefLink(snapshot)) return resolveBinaryRef(ctx, snapshot)
  if (isWorkspaceFileLink(snapshot)) return fileLinkToPart(snapshot)

  // Pre-snapshot parts and unresolvable sends fall back to a lazy read
  if (!session.workspace) return unavailableFileLink(part.path)
  try {
    const file = await readWorkspaceFileLink({
      sessionId: sharedSessionId(session),
      workspaceId: session.workspace.workspaceId,
      path: part.path,
    })
    return fileLinkToPart(file)
  } catch {
    return unavailableFileLink(part.path)
  }
}

function isSkippedLink(value: unknown): value is WorkspaceSkippedLink {
  return (value as { kind?: string } | null)?.kind === 'skipped'
}

function isBinaryRefLink(value: unknown): value is WorkspaceBinaryRefLink {
  return (value as { kind?: string } | null)?.kind === 'binary-ref'
}

async function resolveBinaryRef(ctx: ActionCtx, link: WorkspaceBinaryRefLink) {
  const blob = await ctx.storage.get(link.storageId as Id<'_storage'>)
  if (!blob) return unavailableFileLink(link.path)

  const base64 = encodeBase64(new Uint8Array(await blob.arrayBuffer()))
  return {
    type: 'file' as const,
    url: `data:${link.mediaType};base64,${base64}`,
    mediaType: link.mediaType,
    filename: link.filename,
  }
}

/** Names a link the user made but that is deliberately not injected. */
function skippedFileLink(path: string, reason: string) {
  return {
    type: 'text' as const,
    text: block('file', `Not included: ${reason}.`, {
      path: blockPath(path),
      status: 'skipped',
    }),
  }
}

function unavailableFileLink(path: string) {
  return {
    type: 'text' as const,
    text: block('file', 'This file is no longer available.', {
      path: blockPath(path),
      status: 'unavailable',
    }),
  }
}

function fileLinkToPart(file: WorkspaceFileLink) {
  if (file.kind === 'text') {
    return { type: 'text' as const, text: toFileBlock(file) }
  }
  if (file.kind === 'directory') {
    return { type: 'text' as const, text: toDirectoryBlock(file) }
  }
  return {
    type: 'file' as const,
    url: `data:${file.mediaType};base64,${file.base64}`,
    mediaType: file.mediaType,
    filename: file.filename,
  }
}

export function representMessage(
  stored: Doc<'messages'>,
  agent: Doc<'agents'>,
  parts: UIMessage['parts'],
) {
  const isOtherAgent =
    stored.sender.type === 'agent' && stored.sender.id !== agent._id
  const role = agent.maskOtherAgents && isOtherAgent ? 'user' : stored.role

  if (role === 'user') {
    return {
      role,
      // User messages shouldn't carry reasoning/tool parts
      parts: parts.filter(
        (part) => part.type === 'text' || part.type === 'file',
      ),
    }
  }

  return { role: stored.role, parts }
}

export function prefixSenderName(
  message: UIMessage,
  stored: Doc<'messages'>,
  agent: Doc<'agents'>,
) {
  const senderName = stored.senderSnapshot?.name
  if (!senderName) return message.parts

  const shouldPrefix =
    (stored.sender.type === 'user' && agent.shareUserDisplayNames) ||
    (stored.sender.type === 'agent' &&
      stored.sender.id !== agent._id &&
      agent.shareAgentDisplayNames)
  if (!shouldPrefix) return message.parts

  // Skip injected context blocks so the actual user message is prefixed instead
  const index = message.parts.findIndex(
    (part) => part.type === 'text' && !isInjectedContextBlock(part.text),
  )
  if (index < 0) return message.parts

  return message.parts.map((part, partIndex) =>
    partIndex === index && part.type === 'text'
      ? { ...part, text: `${senderName}: ${part.text}` }
      : part,
  )
}

function isInjectedContextBlock(text: string): boolean {
  return INJECTED_BLOCK_PREFIXES.some((prefix) => text.startsWith(prefix))
}

function isPlanLinkPart(part: unknown): part is PlanLinkPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    part.type === 'plan-link' &&
    'snapshot' in part &&
    typeof (part as { snapshot: unknown }).snapshot === 'object'
  )
}

function isFileLinkPart(
  part: unknown,
): part is { type: 'file-link'; path: string; snapshot?: unknown } {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    part.type === 'file-link' &&
    'path' in part &&
    typeof (part as { path: unknown }).path === 'string'
  )
}

function isWorkspaceFileLink(value: unknown): value is WorkspaceFileLink {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return false
  }

  const link = value as Record<string, unknown>
  if (typeof link.path !== 'string') return false

  if (link.kind === 'text') {
    return (
      typeof link.content === 'string' && typeof link.truncated === 'boolean'
    )
  }

  if (link.kind === 'directory') {
    return (
      Array.isArray(link.entries) &&
      link.entries.every((entry) => typeof entry === 'string') &&
      typeof link.truncated === 'boolean'
    )
  }

  return (
    link.kind === 'binary' &&
    typeof link.base64 === 'string' &&
    typeof link.mediaType === 'string' &&
    typeof link.filename === 'string'
  )
}

function isAttachmentPart(
  part: unknown,
): part is { type: 'file'; url: string; attachmentId: Id<'attachments'> } {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    part.type === 'file' &&
    'attachmentId' in part &&
    'url' in part &&
    typeof (part as { url: unknown }).url === 'string'
  )
}
