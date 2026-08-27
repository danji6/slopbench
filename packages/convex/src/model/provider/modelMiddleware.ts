import type {
  LanguageModelV3,
  LanguageModelV4,
  LanguageModelV4CallOptions,
} from '@ai-sdk/provider'
import type { LanguageModel, LanguageModelMiddleware } from 'ai'

export type ModelRoute = {
  matches: (params: LanguageModelV4CallOptions) => boolean
  validate?: (params: LanguageModelV4CallOptions) => void | Promise<void>
  model?: LanguageModel
  supportedUrls?: Record<string, RegExp[]>
}

/** Applies ordinary AI SDK middleware. */
export async function withMiddleware(
  model: LanguageModel,
  middleware: LanguageModelMiddleware | LanguageModelMiddleware[],
): Promise<LanguageModelV4> {
  const { wrapLanguageModel } = await import('ai')
  return wrapLanguageModel({
    model: model as LanguageModelV3,
    middleware,
  })
}

/** Routes matching model calls through alternate implementations. */
export async function withModelRoutes(
  model: LanguageModel,
  routes: ModelRoute[],
): Promise<LanguageModelV4> {
  const normalized = await Promise.all(
    routes.map(async (route) => ({
      ...route,
      model: route.model
        ? ((await withMiddleware(route.model, {})) as LanguageModelV4)
        : undefined,
    })),
  )

  return withMiddleware(model, {
    overrideSupportedUrls: async ({ model }) => {
      const supported = { ...(await model.supportedUrls) }
      for (const route of normalized) {
        Object.assign(supported, route.supportedUrls)
      }
      return supported
    },
    wrapGenerate: async ({ doGenerate, params }) => {
      const route = normalized.find(({ matches }) => matches(params))
      if (!route) return doGenerate()
      await route.validate?.(params)
      return route.model?.doGenerate(params) ?? doGenerate()
    },
    wrapStream: async ({ doStream, params }) => {
      const route = normalized.find(({ matches }) => matches(params))
      if (!route) return doStream()
      await route.validate?.(params)
      return route.model?.doStream(params) ?? doStream()
    },
  })
}
