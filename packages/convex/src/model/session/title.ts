import type { Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { withParts } from '../messageContents'
import { textFromParts } from '../messages'
import { findCredentialsForModel } from '../provider/providers'
import { syncTitle } from '../userSessions'

export async function _getTitleContext(
  ctx: QueryCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  const session = await ctx.db.get(sessionId)
  if (!session) return null

  const settings = await ctx.db
    .query('settings')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', session.ownerId))
    .unique()

  const modelId = settings?.titleModel

  return {
    exchange: await firstExchange(ctx, sessionId),
    autoTitle: settings?.autoTitle ?? true,
    modelId,
    credentials: modelId
      ? findCredentialsForModel(settings?.modelProviders, modelId)
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

async function firstExchange(ctx: QueryCtx, sessionId: Id<'sessions'>) {
  const messages = await ctx.db
    .query('messages')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .order('asc')
    .take(20)

  const user = messages.find((m) => m.role === 'user')
  const assistant = messages.find(
    (m) => m.role === 'assistant' && m.type !== 'summary',
  )
  if (!user) return undefined

  const userParts = (await withParts(ctx, user)).parts
  const parts = [`User: ${textFromParts(userParts).slice(0, 500)}`]

  if (assistant) {
    const assistantParts = (await withParts(ctx, assistant)).parts
    parts.push(`Assistant: ${textFromParts(assistantParts).slice(0, 500)}`)
  }

  return parts.join('\n').trim() || undefined
}

export async function _patchTitle(
  ctx: MutationCtx,
  args: { sessionId: Id<'sessions'>; title: string },
) {
  await ctx.db.patch(args.sessionId, { title: args.title })
  await syncTitle(ctx, args.sessionId, args.title)
}
