import { discoveredFields } from '@sb/core/discovered-model'
import { limitError } from '@sb/core/limit-errors'
import { MAX_PROVIDER_MODELS } from '@sb/core/limits'
import { parseModelExtraParameters } from '@sb/core/model-parameters'
import { parseProviderExtraHeaders } from '@sb/core/provider-headers'
import {
  providerDefinition,
  providerFeatures,
} from '@sb/core/provider-registry'
import type { ModelEntry } from '@sb/core/types'

import type { Doc } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { CreateModelProviderArgs } from '../../types'
import { normalizeConfiguredReasoning } from './known'

export function validateConnection(args: CreateModelProviderArgs) {
  assertModelsWithinCap(args.models)
  parseProviderExtraHeaders(args.extraHeaders)

  const auth = args.auth ?? 'apiKey'
  if (!args.key.trim()) error('Provider is required', 400)
  if (!providerDefinition(args.key).authentication[auth])
    error('Provider does not support this authentication method', 400)

  const features = providerFeatures(args.key, auth)
  if (features.fixedEndpoint && (args.baseURL || args.extraHeaders))
    error('Account connections use fixed provider endpoints', 400)
  if (
    features.catalogOnly &&
    args.models.some((model) => model.source !== 'discovered')
  ) {
    error('Choose subscription models from discovery', 400)
  }
}

function assertModelsWithinCap(models: ModelEntry[]) {
  if (models.length > MAX_PROVIDER_MODELS) {
    error(limitError('providerModels'), 400)
  }
  const ids = new Set<string>()
  for (const model of models) {
    if (!model.id.trim()) error('Model ID is required', 400)
    if (ids.has(model.id.trim()))
      error('Duplicate model ID in this connection', 400)
    ids.add(model.id.trim())
    assertModelConfig(model)
  }
}

function assertModelConfig(model: ModelEntry) {
  try {
    parseModelExtraParameters(model.extraParameters)
  } catch (err) {
    error(err instanceof Error ? err.message : 'Invalid extra parameters', 400)
  }

  if (model.reasoning?.type === 'binary' && !model.reasoning.parameter.trim()) {
    error('Binary thinking parameter cannot be empty', 400)
  }

  if (model.reasoning?.type === 'effort') {
    const unique = new Set(model.reasoning.efforts)
    if (unique.size !== model.reasoning.efforts.length) {
      error('Reasoning efforts cannot contain duplicates', 400)
    }
  }
}

export function normalizeProviderModels(
  providerId: string,
  models: ModelEntry[],
): ModelEntry[] {
  return models.map((model) => {
    const reasoning = normalizeConfiguredReasoning(providerId, model.reasoning)
    const inference = Object.keys(model.inference ?? {}).length
      ? model.inference
      : undefined
    if (reasoning === model.reasoning && inference === model.inference) {
      return model
    }
    return { ...model, reasoning, inference }
  })
}

/** Derives availability and provider defaults from the last complete catalog. */
export async function validateCatalogModels(
  ctx: MutationCtx,
  provider: Doc<'modelProviders'>,
  models: ModelEntry[],
) {
  const rows = provider.discoveryGeneration
    ? await ctx.db
        .query('modelCatalog')
        .withIndex('by_connection_generation_order', (q) =>
          q
            .eq('connectionId', provider._id)
            .eq('generation', provider.discoveryGeneration!),
        )
        .collect()
    : []

  const ids = new Set(rows.map((row) => row.model.id))

  return models.map((model) => {
    const alreadyConfigured = provider.models.some(
      (current) => current.id === model.id && current.source === 'discovered',
    )
    if (
      model.source === 'discovered' &&
      !ids.has(model.id) &&
      !alreadyConfigured
    ) {
      error('Refresh discovery before enabling this model', 400)
    }

    const discovered = rows.find((row) => row.model.id === model.id)?.model

    return {
      ...model,
      available: model.source === 'discovered' ? ids.has(model.id) : undefined,
      ...(discovered ? discoveredFields(discovered) : {}),
    }
  })
}
