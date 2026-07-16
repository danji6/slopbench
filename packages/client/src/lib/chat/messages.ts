import type { MessageRole } from '@/lib/chat'
import { generateId } from '@/lib/utils'
import type { Doc } from '@sb/convex/_generated/dataModel'
import { minRole } from '@sb/convex/lib/roles'
import type { MessageExtra } from '@sb/convex/types'
import type { FileUIPart, TextUIPart, ToolUIPart, UIMessage } from 'ai'
import { isFileUIPart, isReasoningUIPart, isTextUIPart, isToolUIPart } from 'ai'

import { isToolInFlight } from './parts'
import type { MessageRecord, PartMetadata } from './types'

export type Message = UIMessage & { status: 'processing' | 'done' }

type MessageDoc = Doc<'messages'> & {
  segments: { segmentIndex: number; parts: unknown[] }[]
  hasOlderSegments: boolean
  hasNewerSegments: boolean
}

export type Messages = {
  messages: Message[]
  byId: Map<string, MessageRecord>
  partMetaById: Map<string, PartMetadata>
  summaryId?: string
}

type ConvertedEntry = {
  message: Message
  record: MessageRecord
  partMeta: PartMetadata
  isSummary: boolean
}

// Cache entries to avoid full history reconversions
const conversionCache = new WeakMap<MessageDoc, ConvertedEntry>()

function convertDoc(doc: MessageDoc): ConvertedEntry {
  const cached = conversionCache.get(doc)
  if (cached) return cached

  const parts =
    doc.segments.length === 1
      ? doc.segments[0].parts
      : doc.segments.flatMap((segment) => segment.parts)

  const message = {
    id: doc._id,
    role: doc.role,
    parts: parts as UIMessage['parts'],
    status: doc.status,
  } as Message

  const entry: ConvertedEntry = {
    message: doc.status === 'done' ? finalizeMessageParts(message) : message,
    record: {
      _creationTime: doc._creationTime,
      sender: doc.sender,
      senderSnapshot: doc.senderSnapshot,
      type: doc.type,
      hidden: doc.hidden,
      extra: doc.extra,
      selectedVersion: doc.selectedVersion,
      versionCount: doc.versionCount,
      segments: doc.segments.map((segment) => ({
        index: segment.segmentIndex,
        partCount: segment.parts.length,
      })),
      hasOlderSegments: doc.hasOlderSegments,
      hasNewerSegments: doc.hasNewerSegments,
      metadata: pickMessageMetadata(doc.metadata),
    },
    partMeta: {
      duration: doc.metadata?.duration,
      toolErrors: doc.metadata?.toolErrors,
    },
    isSummary: doc.type === 'summary' && doc.status === 'done',
  }

  conversionCache.set(doc, entry)
  return entry
}

export function convertMessages(docs: MessageDoc[]): Messages {
  const messages: Message[] = []
  const byId = new Map<string, MessageRecord>()
  const partMetaById = new Map<string, PartMetadata>()
  let summaryId: string | undefined

  for (const doc of docs) {
    const { message, record, partMeta, isSummary } = convertDoc(doc)
    messages.push(message)
    byId.set(doc._id, record)
    partMetaById.set(doc._id, partMeta)
    if (isSummary) summaryId = doc._id
  }

  return { messages, byId, partMetaById, summaryId }
}

/** Narrows a record's `extra` payload to the shape owned by its type. */
export function messageExtra<T extends keyof MessageExtra>(
  record: MessageRecord | undefined,
  type: T,
): MessageExtra[T] | undefined {
  return record?.type === type ? (record.extra as MessageExtra[T]) : undefined
}

function pickMessageMetadata(
  metadata: Doc<'messages'>['metadata'],
): MessageRecord['metadata'] {
  if (!metadata) return undefined

  const result = {
    error: metadata.error,
    warnings: metadata.warnings,
    usage: metadata.usage,
  }

  if (
    result.error === undefined &&
    result.warnings === undefined &&
    result.usage === undefined
  ) {
    return undefined
  }

  return result
}

export type BuildUIMessageProps = {
  content?: string | null
  files?: FileUIPart[] | null
  role?: MessageRole
}

export function buildUIMessage(props: BuildUIMessageProps = {}): UIMessage {
  const { content, files, role } = props
  return {
    id: generateId(),
    role: role ?? 'user',
    parts: [
      ...(files ?? []),
      { type: 'text', text: content?.trim() ?? '' } as TextUIPart,
    ],
  }
}

export function isMessageEmpty(message: UIMessage | null | undefined): boolean {
  if (!message) return true
  if (message.parts.length === 0) return true

  return message.parts.every((part) => {
    if (isTextUIPart(part)) {
      return !part.text || part.text.trim() === ''
    }
    if (isReasoningUIPart(part)) {
      const text = part.text
      return !text || text.trim() === ''
    }

    return false
  })
}

export function isMessageStreaming(
  message: UIMessage | null | undefined,
): boolean {
  if (!message) return false
  return message.parts.some(
    (part) => 'state' in part && part.state === 'streaming',
  )
}

export function isMessagePending(message: UIMessage): boolean {
  return (
    message.role !== 'system' &&
    (message as { status?: string }).status === 'processing' &&
    !hasVisibleMessageContent(message)
  )
}

export function hasVisibleMessageContent(message: UIMessage): boolean {
  return message.parts.some((part) => {
    if (isTextUIPart(part) || isReasoningUIPart(part)) {
      return part.text.trim().length > 0
    }
    if (isFileUIPart(part)) return true
    if (isToolUIPart(part) && part.type !== 'dynamic-tool') return true
    return false
  })
}

export function hasInFlightTool(message: UIMessage): boolean {
  return message.parts.some(
    (part) =>
      isToolUIPart(part) &&
      part.type !== 'dynamic-tool' &&
      isToolInFlight(part),
  )
}

/** The part currently being streamed, if any. */
export function streamingPart(
  message: UIMessage,
): UIMessage['parts'][number] | undefined {
  return message.parts.find(
    (part) => 'state' in part && part.state === 'streaming',
  )
}

export function isStreamingReasoning(message: UIMessage): boolean {
  const part = streamingPart(message)
  return part !== undefined && isReasoningUIPart(part)
}

/** Used to detect stream inactivity without diffing whole parts. */
export function messageActivitySignature(message: UIMessage): string {
  return message.parts
    .map((part) => {
      if (isTextUIPart(part) || isReasoningUIPart(part)) return part.text.length
      if ('state' in part) return (part as { state?: string }).state ?? ''
      return part.type
    })
    .join('|')
}

export function sanitizeMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map(finalizeMessageParts).filter((m) => !isMessageEmpty(m))
}

/** Ensures there are no dangling streaming parts in the message. */
export function finalizeMessageParts<T extends UIMessage>(message: T): T {
  const parts = message.parts.map((part) => {
    if ('state' in part && part.state === 'streaming') {
      return { ...part, state: 'done' }
    }
    if (
      part.type.startsWith('tool-') &&
      (part as ToolUIPart).state === 'input-streaming'
    ) {
      return { ...part, state: 'output-error' }
    }
    return part
  })
  return { ...message, parts: parts as UIMessage['parts'] }
}

export function extractTextFromMessage(message: UIMessage): string {
  return message.parts.reduce(
    (acc, part) => (isTextUIPart(part) ? acc + part.text : acc),
    '',
  )
}

/** A message can be inline-edited when it is a single plain text part. */
export function isEditableMessage(message: UIMessage): boolean {
  return message.parts.filter(isTextUIPart).length === 1
}

/** Whether the current user may edit or delete this message. */
export function canMutateMessage(
  message: UIMessage,
  record: MessageRecord | undefined,
  session: Doc<'sessions'> | null,
  profile: Doc<'users'> | null,
): boolean {
  if (!session || !profile || isMessageProcessing(message)) return false

  const isSessionOwner = session.ownerId === profile._id
  if (session.settings?.disabled && !isSessionOwner) return false

  return (
    record?.sender.type !== 'user' ||
    record.sender.id === profile._id ||
    isSessionOwner ||
    minRole(profile.role, 'moderator')
  )
}

function isMessageProcessing(message: UIMessage): boolean {
  return (message as { status?: string }).status === 'processing'
}

/** Returns the id of the most recent user message only if it's editable. */
export function latestEditableUserMessageId(
  ids: string[],
  getMessage: (id: string) => UIMessage | null,
): string | null {
  for (let index = ids.length - 1; index >= 0; index--) {
    const message = getMessage(ids[index]!)
    if (!message || message.role !== 'user') continue
    return isEditableMessage(message) ? message.id : null
  }
  return null
}
