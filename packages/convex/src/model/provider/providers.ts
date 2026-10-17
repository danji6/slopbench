import { modelReference, parseModelReference } from '@sb/core/model-reference'
import type { UIModel, UIModelConfig } from '@sb/core/types/providers'

import type { Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import type { AuthQueryCtx } from '../../functions'
import type {
  ModelEntry,
  ModelProviderConfig,
  ModelSelection,
} from '../../types'
import { resolve as resolveProviders } from '../providers'
import { resolveModelReasoning } from './known'

export type ProviderCredentials = {
  connectionId?: string
  ownerId?: string
  configRevision?: number
  auth?: 'apiKey' | 'chatgpt'
  providerId?: string
  apiKey?: string
  baseURL?: string
  extraHeaders?: string
  model?: ModelEntry
}

export type { UIModel, UIModelConfig } from '@sb/core/types/providers'

export async function list(ctx: AuthQueryCtx): Promise<UIModelConfig> {
  try {
    const providers = await resolveProviders(ctx, ctx.userId)

    const models: UIModel[] = providers
      .filter((p) => p.enabled)
      .flatMap((p) =>
        p.models
          .filter((m) => m.id.trim().length > 0)
          .map((m) => ({
            id: p.connectionId
              ? modelReference(p.connectionId, m.id.trim())
              : m.id.trim(),
            connectionId: p.connectionId,
            connectionName: p.name ?? p.id,
            subscription: p.auth === 'chatgpt',
            available: m.available,
            label: m.label ?? m.id.trim(),
            contextWindow: m.contextWindow,
            local: p.id === 'ollama',
            reasoning: resolveModelReasoning(p.id, m.reasoning),
            inference: m.inference,
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
  const reference = parseModelReference(modelId ?? '')
  const provider = findConnection(providers, reference)
  return provider
    ? {
        connectionId: provider.connectionId,
        ownerId: provider.ownerId,
        configRevision: provider.configRevision,
        auth: provider.auth,
        providerId: provider.id,
        apiKey: provider.apiKey,
        baseURL: provider.baseURL,
        extraHeaders: provider.extraHeaders,
        model: provider.models.find((m) => m.id.trim() === reference.modelId),
      }
    : null
}

export function findModelSelection(
  value: unknown,
  modelId?: string,
): ModelSelection | null {
  if (!modelId) return null

  const providers = (value ?? []) as ModelProviderConfig[]
  const reference = parseModelReference(modelId ?? '')
  const provider = findConnection(providers, reference)
  if (!provider) return null

  const model = provider.models.find((m) => m.id.trim() === reference.modelId)
  if (!model) return null

  return {
    id: provider.connectionId
      ? modelReference(provider.connectionId, model.id.trim())
      : model.id.trim(),
    label: model.label ?? (provider.connectionId ? model.id.trim() : undefined),
    contextWindow: model.contextWindow,
    reasoning: resolveModelReasoning(provider.id, model.reasoning),
    extraParameters: model.extraParameters,
  }
}

function findConnection(
  providers: ModelProviderConfig[],
  reference: ReturnType<typeof parseModelReference>,
) {
  const matches = providers.filter(
    (provider) =>
      provider.enabled &&
      provider.models.some((model) => model.id.trim() === reference.modelId),
  )
  if (reference.connectionId)
    return matches.find(
      (provider) => provider.connectionId === reference.connectionId,
    )
  return matches.length === 1 ? matches[0] : undefined
}
