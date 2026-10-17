import { z } from 'zod'

import { positive } from './metadata'
import type { DiscoveryAdapter } from './types'

const schema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1).max(1024),
      name: z.string().max(1024).optional(),
      context_length: z.number().nullish(),
      architecture: z
        .object({ output_modalities: z.array(z.string()).optional() })
        .optional(),
    }),
  ),
  links: z.object({ next: z.string().nullable().optional() }).optional(),
})

export const openRouterAdapter: DiscoveryAdapter = {
  first: (c) =>
    `${c.baseURL?.replace(/\/$/, '') ?? 'https://openrouter.ai/api/v1'}/models?offset=0&limit=500`,
  headers: (c): Record<string, string> =>
    c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {},
  page: (data) => {
    const parsed = schema.parse(data)
    return {
      next: parsed.links?.next ?? undefined,
      models: parsed.data
        .filter(
          (m) =>
            !m.architecture?.output_modalities ||
            m.architecture.output_modalities.includes('text'),
        )
        .map((m) => ({
          id: m.id,
          label: m.name,
          contextWindow: positive(m.context_length),
        })),
    }
  },
}
