import {
  DEFAULT_TITLE_SYSTEM_PROMPT,
  TITLE_EXCERPT_LENGTH,
  truncateTitleExcerpt,
} from '@cv/core/title-generation'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import { findUserBySubject } from '../../functions'
import { queryMessageSegments } from '../messageContents'
import { hasSavedTitle, isTextPart, textFromParts } from '../messages'
import { findCredentialsForModel } from '../provider/providers'
import { resolve as resolveProviders } from '../providers'
import { getByOwnerId as getSettings } from '../settings'
import { syncTitle } from '../userSessions'
import { getMembership } from './memberships'

export async function _getTitleContext(
  ctx: QueryCtx,
  {
    sessionId,
    assistantText,
  }: { sessionId: Id<'sessions'>; assistantText?: string },
) {
  const session = await ctx.db.get(sessionId)
  if (!session || hasSavedTitle(session)) return null
  return readTitleContext(ctx, session, assistantText)
}

export async function _getRegenerateTitleContext(
  ctx: QueryCtx,
  { sessionId, subject }: { sessionId: Id<'sessions'>; subject: string },
) {
  const user = await findUserBySubject(ctx, subject)
  if (!user) error('Profile not initialized', 409)
  const membership = await getMembership(ctx, sessionId, user._id)
  if (!membership) error('Not found', 404)

  const session = await ctx.db.get(sessionId)
  if (!session) error('Not found', 404)
  return readTitleContext(ctx, session)
}

async function readTitleContext(
  ctx: QueryCtx,
  session: Doc<'sessions'>,
  assistantText?: string,
) {
  const settings = await getSettings(ctx, session.ownerId)
  const modelId = settings?.titleModel
  const exchange = await firstExchange(
    ctx,
    session._id,
    Boolean(modelId),
    assistantText,
  )

  return {
    exchange,
    modelId,
    systemPrompt: settings?.titleSystemPrompt ?? DEFAULT_TITLE_SYSTEM_PROMPT,
    credentials:
      modelId && exchange
        ? findCredentialsForModel(
            await resolveProviders(ctx, session.ownerId),
            modelId,
          )
        : undefined,
  }
}

/** Derives a fallback title from the first line of a message exchange. */
export function fallbackTitle(text: string) {
  const firstLine = text.split('\n')[0]?.replace(/^User:\s*/, '') ?? ''
  return sanitizeTitle(firstLine)
}

export function sanitizeTitle(raw: string) {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^(title|chat|conversation)\s*[:-]\s*/i, '')
    .replace(/[.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .slice(0, 100)
    .trim()
}

/** Resolves a display title, falling back to the first user message. */
export function resolveTitle(
  title: string | undefined,
  messages: { role: string; parts: unknown[] }[],
): string {
  const trimmed = title?.trim()
  if (trimmed) return trimmed

  const user = messages.find((message) => message.role === 'user')
  const fallback = user ? fallbackTitle(textFromParts(user.parts)) : ''
  return fallback || 'Untitled chat'
}

async function firstExchange(
  ctx: QueryCtx,
  sessionId: Id<'sessions'>,
  includeAssistant: boolean,
  assistantText?: string,
) {
  const messages = await ctx.db
    .query('messages')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .order('asc')
    .take(20)

  const user = messages.find((m) => m.role === 'user')
  if (!user) return undefined

  const userText = await readExcerpt(ctx, user)
  if (!includeAssistant)
    return userText.trim() ? `User: ${userText}` : undefined

  if (assistantText === undefined) {
    const assistant = messages.find(
      (m) => m.role === 'assistant' && m.type !== 'summary',
    )
    if (assistant) assistantText = await readExcerpt(ctx, assistant)
  } else {
    assistantText = truncateTitleExcerpt(assistantText)
  }

  if (!userText.trim() && !assistantText?.trim()) return undefined

  const userLine = `User: ${userText}`
  return (
    assistantText === undefined
      ? userLine
      : `${userLine}\nAssistant: ${assistantText}`
  ).trim()
}

/** Reads only the selected segments needed for the title prompt. */
async function readExcerpt(ctx: QueryCtx, message: Doc<'messages'>) {
  let excerpt = ''
  let seenTextPart = false
  const segments = queryMessageSegments(
    ctx,
    message._id,
    message.selectedVersion,
  )

  for await (const segment of segments) {
    for (const part of segment.parts) {
      if (!isTextPart(part)) continue
      if (seenTextPart) excerpt += ' '
      seenTextPart = true
      excerpt += part.text.slice(0, TITLE_EXCERPT_LENGTH - excerpt.length)
      if (excerpt.length === TITLE_EXCERPT_LENGTH) {
        return truncateTitleExcerpt(excerpt)
      }
    }
  }
  return excerpt
}

export async function _patchTitle(
  ctx: MutationCtx,
  args: { sessionId: Id<'sessions'>; title: string },
) {
  const session = await ctx.db.get(args.sessionId)
  if (!session || hasSavedTitle(session)) return

  await ctx.db.patch(args.sessionId, {
    title: args.title,
    titleGenerationJobId: undefined,
  })
  await syncTitle(ctx, args.sessionId, args.title)
}
