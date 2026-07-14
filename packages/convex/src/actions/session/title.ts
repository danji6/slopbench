'use node'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { fallbackTitle, sanitizeTitle } from '../../model/session/title'

/** Regenerates title without persisting it. Forces the model regardless of
 * the `autoTitle` setting, since it is an explicit user request. */
export async function regenerateTitle(
  ctx: ActionCtx,
  args: { sessionId: Id<'sessions'> },
): Promise<string | undefined> {
  return composeTitle(ctx, { ...args, forceModel: true })
}

// TODO make this user-configurable
const TITLE_SYSTEM_PROMPT = [
  'Your task is to generate a concise title for a chat conversation.',
  'Rules:',
  '- 3 to 6 words, summarizing the topic as a plain noun phrase.',
  '- No surrounding quotes, no trailing punctuation.',
  '- Do not start with "Chat", "Conversation", "Title", or similar filler.',
  '- Match the language of the conversation.',
  'Return only the title.',
].join('\n')

/** Generates and persists a title for the given session. */
export async function generateTitle(
  ctx: ActionCtx,
  args: { sessionId: Id<'sessions'> },
): Promise<string | undefined> {
  const title = await composeTitle(ctx, args)
  if (title) {
    await ctx.runMutation(internal.sessions._patchTitle, {
      sessionId: args.sessionId,
      title,
    })
  }
  return title
}

async function composeTitle(
  ctx: ActionCtx,
  {
    sessionId,
    forceModel,
  }: { sessionId: Id<'sessions'>; forceModel?: boolean },
): Promise<string | undefined> {
  const resolved = await ctx.runQuery(internal.sessions._getTitleContext, {
    sessionId,
  })
  if (!resolved?.exchange) {
    console.warn(
      `composeTitle: no message exchange found for session ${sessionId}, skipping`,
    )
    return
  }

  const fallback = fallbackTitle(resolved.exchange)

  // When autoTitle is off, skip the model call and use the fallback title
  if (!resolved.autoTitle && !forceModel) return fallback

  if (!resolved.modelId) {
    console.warn('composeTitle: no titleModel configured, using fallback title')
    return fallback
  }
  if (!resolved.credentials?.providerId) {
    console.warn(
      `composeTitle: no provider configured for titleModel "${resolved.modelId}", using fallback title`,
    )
    return fallback
  }

  try {
    const [{ getProviderOptions }, { generateText }] = await Promise.all([
      import('../../model/provider/options'),
      import('ai'),
    ])

    const { languageModel, providerOptions } = await getProviderOptions(
      resolved.modelId,
      'none', // no reasoning
      undefined,
      resolved.credentials,
    )

    const result = await generateText({
      model: languageModel,
      system: TITLE_SYSTEM_PROMPT,
      prompt: resolved.exchange,
      maxRetries: 1,
      maxOutputTokens: 512,
      providerOptions,
    })

    const cleaned = sanitizeTitle(result.text)
    if (cleaned) return cleaned

    console.warn(
      `composeTitle: model "${resolved.modelId}" returned empty text (finishReason: ${result.finishReason}), using fallback title`,
    )
  } catch (err) {
    // Fall back to the truncated first message on any provider/config failure
    console.error(
      `composeTitle: provider call failed for model "${resolved.modelId}", using fallback title`,
      err,
    )
  }

  return fallback
}
