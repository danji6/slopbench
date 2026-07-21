import { hasInterpolation } from '@sb/core/interpreter/parse'
import type { UIMessage } from 'ai'
import type { FilterBuilder, NamedTableInfo } from 'convex/server'

import { internal } from '../_generated/api'
import type { DataModel, Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

const PREVIEW_LENGTH = 140

/**
 * Schedules title resolution for a session that has no title yet. The action
 * generates one with a model when `autoTitle` is on, or falls back to a
 * truncated first message otherwise.
 */
export async function scheduleTitle(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
) {
  const session = await ctx.db.get(sessionId)
  if (!session || session.title) return

  await ctx.scheduler.runAfter(0, internal.actions.sessions._generateTitle, {
    sessionId,
  })
}

/** Denormalizes the latest activity onto the session and its membership rows. */
export async function syncActivity(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  parts: unknown[],
) {
  const now = Date.now()
  const text = textFromParts(parts).trim()
  const preview = text ? text.slice(0, PREVIEW_LENGTH) : undefined

  const session = await ctx.db.get(sessionId)

  await ctx.db.patch(sessionId, {
    lastMessageAt: now,
    lastMessagePreview: preview,
    ...(preview && !session?.firstMessagePreview
      ? { firstMessagePreview: preview }
      : {}),
  })

  const members = await ctx.db
    .query('userSessions')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()

  for (const member of members) {
    await ctx.db.patch(member._id, { lastMessageAt: now })
  }
}

export function textFromParts(parts: unknown[]) {
  return parts
    .filter(
      (part): part is { type: 'text'; text: string } =>
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        part.type === 'text' &&
        'text' in part,
    )
    .map((part) => part.text)
    .join(' ')
}

const SEARCH_TEXT_LIMIT = 10_000
const TOOL_INPUT_LIMIT = 500

/**
 * Flattens a message's text parts into a single searchable string.
 * Reasoning parts and tool outputs are excluded.
 */
export function searchTextFromParts(parts: unknown[]): string {
  const segments: string[] = []

  for (const part of parts) {
    if (!isMessagePartRecord(part)) continue
    const { type } = part

    if (type === 'text' && typeof part.text === 'string') {
      segments.push(part.text)
      continue
    }

    if (typeof type === 'string' && type.startsWith('tool-')) {
      const input = toolInputText(part.input)
      if (input) segments.push(input)
    }
  }

  return segments.join('\n').slice(0, SEARCH_TEXT_LIMIT)
}

function toolInputText(input: unknown): string {
  if (typeof input === 'string') return input.slice(0, TOOL_INPUT_LIMIT)
  if (!isMessagePartRecord(input)) return ''
  if (typeof input.command === 'string') {
    return input.command.slice(0, TOOL_INPUT_LIMIT)
  }
  try {
    return JSON.stringify(input).slice(0, TOOL_INPUT_LIMIT)
  } catch {
    return ''
  }
}

export function finalizeMessageParts(parts: unknown[]) {
  return parts.map((part) => {
    if (!isMessagePartRecord(part)) return part

    if (part.state === 'streaming') {
      return { ...part, state: 'done' }
    }

    if (
      typeof part.type === 'string' &&
      part.type.startsWith('tool-') &&
      part.state === 'input-streaming'
    ) {
      return { ...part, state: 'output-error' }
    }

    if (
      typeof part.type === 'string' &&
      part.type.startsWith('tool-') &&
      part.state === 'output-available' &&
      part.preliminary === true
    ) {
      return {
        ...part,
        preliminary: undefined,
        output: finalizeRunningToolOutput(part.output),
      }
    }

    return part
  })
}

function finalizeRunningToolOutput(output: unknown) {
  if (!isMessagePartRecord(output) || output.status !== 'running') return output
  return { ...output, status: 'killed' }
}

export function removeEmptyAssistantMessages(messages: UIMessage[]) {
  return messages.filter((message) => !isEmptyAssistantMessage(message))
}

export function isEmptyAssistantMessage(message: UIMessage) {
  return (
    message.role === 'assistant' &&
    message.parts.every((part) => {
      if (part.type === 'text' || part.type === 'reasoning') {
        return part.text.trim().length === 0
      }
      return false
    })
  )
}

export function shouldSaveSubmittedPrompt(
  prompt: string,
  filesCount: number,
  regenerate?: boolean,
) {
  return !regenerate || prompt.trim().length > 0 || filesCount > 0
}

export function isContextEligible(parts: unknown[]) {
  return parts.length > 0
}

type MessageFilter = FilterBuilder<NamedTableInfo<DataModel, 'messages'>>

/**
 * Command chips are user-facing markers with no content. Turn logic must look
 * past them, or they read as an interjection that splits or extends a turn.
 */
export const notACommandChip = (q: MessageFilter) =>
  q.neq(q.field('type'), 'command')

export async function scheduleMessageEval(
  ctx: MutationCtx,
  {
    messageId,
    invokerId,
    parts,
    version,
    segmentIndex,
  }: {
    messageId: Id<'messages'>
    invokerId: Id<'users'>
    /** The target segment's parts (used to skip script-free segments). */
    parts: unknown[]
    version: number
    segmentIndex: number
  },
) {
  if (!partsHaveScript(parts)) return
  await ctx.scheduler.runAfter(0, internal.actions.messages._evalMessage, {
    messageId,
    invokerId,
    version,
    segmentIndex,
  })
}

export function partsHaveScript(parts: unknown[]): boolean {
  return parts.some(
    (part) =>
      isMessagePartRecord(part) &&
      part.type === 'text' &&
      typeof part.text === 'string' &&
      hasInterpolation(part.text),
  )
}

export function stripMessageError(metadata: Doc<'messages'>['metadata']) {
  if (!metadata?.error) return metadata

  const { error: _error, ...rest } = metadata
  return Object.keys(rest).length > 0 ? rest : undefined
}

function isMessagePartRecord(part: unknown): part is Record<string, unknown> {
  return typeof part === 'object' && part !== null && !Array.isArray(part)
}
