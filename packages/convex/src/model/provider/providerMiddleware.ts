import {
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
} from '@ai-sdk/provider'
import type { LanguageModel } from 'ai'

import { withModelRoutes } from './modelMiddleware'

export async function withProviderMiddleware({
  model,
  videoModel,
}: {
  model: LanguageModel
  videoModel?: LanguageModel
}): Promise<LanguageModelV4> {
  return withModelRoutes(
    model,
    videoModel
      ? [
          {
            matches: ({ prompt }) => promptHasVideo(prompt),
            model: videoModel,
            // Empty patterns make the AI SDK inline URL videos
            supportedUrls: { 'video/*': [] },
          },
        ]
      : [],
  )
}

function promptHasVideo(prompt: LanguageModelV4CallOptions['prompt']) {
  for (const message of prompt) {
    if (message.role !== 'user' || typeof message.content === 'string') continue
    for (const part of message.content) {
      if (part.type !== 'file') continue
      const mediaType = part.mediaType.toLowerCase()
      if (mediaType.startsWith('video/')) return true
    }
  }
  return false
}
