import type { Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import type { AuthQueryCtx } from '../../functions'
import type { ModelEntry, ModelProviderConfig } from '../../types'
import { resolve as resolveProviders } from '../providers'
import { resolveModelReasoning } from './known'

export type ProviderCredentials = {
  providerId?: string
  apiKey?: string
  baseURL?: string
  extraHeaders?: string
  model?: ModelEntry
}

export type UIModel = {
  id: string
  label?: string
  contextWindow?: number
  local?: boolean
  reasoning?: ModelEntry['reasoning']
}

export type UIModelConfig = {
  models: UIModel[]
}

export async function list(ctx: AuthQueryCtx): Promise<UIModelConfig> {
  try {
    const providers = await resolveProviders(ctx, ctx.userId)

    const models: UIModel[] = providers
      .filter((p) => p.enabled)
      .flatMap((p) =>
        p.models
          .filter((m) => m.id.trim().length > 0)
          .map((m) => ({
            id: m.id.trim(),
            label: m.label,
            contextWindow: m.contextWindow,
            local: p.id === 'ollama',
            reasoning: resolveModelReasoning(p.id, m.reasoning),
          })),
      )

    return { models }
  } catch {
    return { models: [] }
  }
}

export async function _getProviderForModel(
  ctx: QueryCtx,
  { ownerId, modelId }: { ownerId: Id<'users'>; modelId: string },
) {
  return findCredentialsForModel(await resolveProviders(ctx, ownerId), modelId)
}

export function findCredentialsForModel(
  value: unknown,
  modelId?: string,
): ProviderCredentials | null {
  const providers = (value ?? []) as ModelProviderConfig[]
  const provider = providers.find((p) =>
    p.models.some((m) => m.id.trim() === modelId),
  )
  return provider
    ? {
        providerId: provider.id,
        apiKey: provider.apiKey,
        baseURL: provider.baseURL,
        extraHeaders: provider.extraHeaders,
        model: provider.models.find((m) => m.id.trim() === modelId),
      }
    : null
}

export function findModelEntry(
  value: unknown,
  modelId?: string,
): ModelEntry | null {
  if (!modelId) return null

  const providers = (value ?? []) as ModelProviderConfig[]
  const provider = providers.find((p) =>
    p.models.some((m) => m.id.trim() === modelId),
  )
  if (!provider) return null

  const model = provider.models.find((m) => m.id.trim() === modelId)
  if (!model) return null

  return {
    id: model.id.trim(),
    label: model.label,
    contextWindow: model.contextWindow,
    reasoning: resolveModelReasoning(provider.id, model.reasoning),
    extraParameters: model.extraParameters,
  }
}
