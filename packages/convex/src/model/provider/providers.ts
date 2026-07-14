import type { Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import type { AuthQueryCtx } from '../../functions'
import type { ModelEntry, ModelProviderConfig } from '../../types'
import { getOrDefault as getSettings } from '../settings'

export type ProviderCredentials = {
  providerId?: string
  apiKey?: string
  baseURL?: string
}

export type UIModel = {
  id: string
  label?: string
  contextWindow?: number
  local?: boolean
}

export type UIModelConfig = {
  models: UIModel[]
}

export async function list(ctx: AuthQueryCtx): Promise<UIModelConfig> {
  try {
    const settings = await getSettings(ctx)
    const providers: ModelProviderConfig[] = settings.modelProviders ?? []

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
  const doc = await ctx.db
    .query('settings')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', ownerId))
    .unique()

  return findCredentialsForModel(doc?.modelProviders, modelId)
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
  const model = provider?.models.find((m) => m.id.trim() === modelId)
  if (!model) return null

  return {
    id: model.id.trim(),
    label: model.label,
    contextWindow: model.contextWindow,
  }
}
