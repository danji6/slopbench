import type { LanguageModelUsage } from 'ai'

import type { TokenUsage } from '../../types'
import { estimateTokens } from '../context'

export async function resolveUsage(args: {
  usage: LanguageModelUsage | undefined
  outputText: string
}): Promise<TokenUsage> {
  const inputTokens = args.usage?.inputTokens ?? 0
  const outputTokens = args.usage?.outputTokens ?? 0

  let totalTokens = args.usage?.totalTokens ?? 0
  if (!totalTokens) {
    totalTokens =
      inputTokens + outputTokens || (await estimateTokens(args.outputText))
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  }
}
