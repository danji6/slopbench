import type {
  DiscoveredModel,
  DiscoveryConnection,
} from '@sb/core/model-discovery'
import { parseProviderExtraHeaders } from '@sb/core/provider-headers'
import { REASONING_TIERS } from '@sb/core/types'
import { z } from 'zod'

import { inferenceDefaults, positive } from './metadata'
import type { DiscoveryAdapter } from './types'

export function ollamaBase(c: DiscoveryConnection) {
  return c.baseURL?.replace(/\/$/, '') ?? 'http://localhost:11434/api'
}

export const ollamaAdapter: DiscoveryAdapter = {
  details: async (connection, model, request) => {
    const response = await request(`${ollamaBase(connection)}/show`, {
      method: 'POST',
      headers: {
        ...parseProviderExtraHeaders(connection.extraHeaders),
        ...ollamaAdapter.headers(connection),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: model.id }),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error('Model details are unavailable')

    return {
      ...model,
      ...ollamaMetadata(await response.json()),
      detailsLoaded: true,
    }
  },
  first: (c) => `${ollamaBase(c)}/tags`,
  headers: (c): Record<string, string> =>
    c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {},
  page: (data) => ({
    models: z
      .object({
        models: z.array(
          z.object({
            name: z.string().min(1).max(1024).optional(),
            model: z.string().min(1).max(1024).optional(),
            digest: z.string().max(1024).optional(),
          }),
        ),
      })
      .parse(data)
      .models.map((m) => {
        const id = m.name ?? m.model
        if (!id?.trim())
          throw new Error('The provider returned a model without an ID')
        return { id, label: id, detailKey: m.digest }
      }),
  }),
}

const detail = z.object({
  model_info: z.record(z.string(), z.unknown()).optional(),
  parameters: z.string().optional(),
  thinking: z
    .object({ values: z.array(z.union([z.boolean(), z.string()])) })
    .optional(),
  capabilities: z.array(z.string()).optional(),
})

export function ollamaMetadata(data: unknown): Partial<DiscoveredModel> {
  const parsed = detail.parse(data)
  const architecture = parsed.model_info?.['general.architecture']
  const maximum = parsed.model_info?.[`${architecture}.context_length`]
  const values = parsed.thinking?.values
  const efforts = REASONING_TIERS.filter((tier) => values?.includes(tier))
  const parameters = Object.fromEntries(
    (parsed.parameters ?? '').split('\n').map((line) => {
      const [key, value] = line.trim().split(/\s+/)
      return [key, Number(value)]
    }),
  )

  return {
    contextWindow: positive(maximum),
    inference: inferenceDefaults(parameters),
    reasoning: efforts.length
      ? { type: 'effort', efforts }
      : values?.some((v) => typeof v === 'boolean')
        ? { type: 'binary', parameter: 'think' }
        : parsed.capabilities && !parsed.capabilities.includes('thinking')
          ? { type: 'none' }
          : undefined,
  }
}
