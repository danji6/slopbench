import type { DiscoveredModel } from '@sb/core/model-discovery'
import { REASONING_TIERS } from '@sb/core/types'
import { z } from 'zod'

import { positive } from './metadata'
import type { DiscoveryAdapter } from './types'

const capability = z.object({ supported: z.boolean() })

const schema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1).max(1024),
      display_name: z.string().max(1024).optional(),
      lifecycle: z.string().optional(),
      max_input_tokens: z.number().nullish(),
      max_tokens: z.number().nullish(),
      capabilities: z
        .object({
          effort: z
            .record(z.string(), z.union([capability, z.boolean(), z.null()]))
            .nullish(),
          thinking: capability.nullish(),
        })
        .nullish(),
    }),
  ),
  has_more: z.boolean().optional(),
  last_id: z.string().nullable().optional(),
})

export const anthropicAdapter: DiscoveryAdapter = {
  first: (c) =>
    `${c.baseURL?.replace(/\/$/, '') ?? 'https://api.anthropic.com/v1'}/models`,
  headers: (c) => ({
    'x-api-key': c.apiKey ?? '',
    'anthropic-version': '2023-06-01',
  }),
  page: (data, url) => {
    const parsed = schema.parse(data)
    let next: string | undefined
    if (parsed.has_more) {
      if (!parsed.last_id) throw new Error('Invalid model catalog pagination')
      const nextURL = new URL(url)
      nextURL.searchParams.set('after_id', parsed.last_id)
      next = nextURL.href
    }
    return {
      next,
      models: parsed.data
        .filter((m) => m.lifecycle !== 'retired')
        .map((m): DiscoveredModel => {
          const effort = m.capabilities?.effort
          const efforts = REASONING_TIERS.filter((tier) => {
            const value = effort?.[tier]
            return typeof value === 'object' && value?.supported
          })
          return {
            id: m.id,
            label: m.display_name,
            contextWindow: positive(m.max_input_tokens),
            outputLimit: positive(m.max_tokens),
            reasoning: efforts.length
              ? { type: 'effort', efforts }
              : m.capabilities?.thinking?.supported === false
                ? { type: 'none' }
                : undefined,
          }
        }),
    }
  },
}
