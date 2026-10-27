import type { LanguageModelV4Usage } from '@ai-sdk/provider'
import type { LanguageModel } from 'ai'

import { withMiddleware } from './modelMiddleware'

export type UsageAdapter = (usage: LanguageModelV4Usage) => LanguageModelV4Usage

/** Applies provider usage corrections to both generated and streamed responses. */
export function withUsageAdapter(model: LanguageModel, adapt: UsageAdapter) {
  return withMiddleware(model, {
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate()
      return { ...result, usage: adapt(result.usage) }
    },
    wrapStream: async ({ doStream }) => {
      const result = await doStream()
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream({
            transform(part, controller) {
              controller.enqueue(
                part.type === 'finish'
                  ? { ...part, usage: adapt(part.usage) }
                  : part,
              )
            },
          }),
        ),
      }
    },
  })
}
