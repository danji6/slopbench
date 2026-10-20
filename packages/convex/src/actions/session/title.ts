'use node'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { fallbackTitle, sanitizeTitle } from '../../model/session/title'

/** Regenerates a title without persisting it. */
export async function regenerateTitle(
  ctx: ActionCtx,
  args: { sessionId: Id<'sessions'> },
): Promise<string | undefined> {
  return composeTitle(ctx, args)
}

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
  { sessionId }: { sessionId: Id<'sessions'> },
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

  if (!resolved.modelId) return fallback
  if (!resolved.credentials?.providerId) {
    console.warn(
      `composeTitle: no provider configured for titleModel "${resolved.modelId}", using fallback title`,
    )
    return fallback
  }

  try {
    const [{ getProviderOptions }, { generateText, streamText }] =
      await Promise.all([import('../../model/provider/options'), import('ai')])

    const { languageModel, providerOptions } = await getProviderOptions(
      resolved.modelId,
      'none', // no reasoning
      resolved.credentials,
    )

    const generate =
      resolved.credentials.auth === 'chatgpt' ? streamText : generateText
    const result = await generate({
      model: languageModel,
      system: resolved.systemPrompt,
      prompt: resolved.exchange,
      maxRetries: 1,
      maxOutputTokens: 512,
      providerOptions,
    })

    const cleaned = sanitizeTitle(await result.text)
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
