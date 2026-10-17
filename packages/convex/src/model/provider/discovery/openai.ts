import { z } from 'zod'

import type { DiscoveryAdapter } from './types'

export const openAIAdapter: DiscoveryAdapter = {
  first: (c) =>
    `${c.baseURL?.replace(/\/$/, '') ?? 'https://api.openai.com/v1'}/models`,
  headers: (c): Record<string, string> =>
    c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {},
  page: (data) => ({
    models: z
      .object({ data: z.array(z.object({ id: z.string().min(1).max(1024) })) })
      .parse(data).data,
  }),
}

export const chatGPTAdapter: DiscoveryAdapter = {
  first: () => 'https://api.openai.com/v1/models',
  headers: () => ({}),
  page: (data) => ({
    models: z
      .object({
        models: z.array(
          z.object({
            slug: z.string().min(1).max(1024),
            display_name: z.string().max(1024).optional(),
            visibility: z.string().optional(),
          }),
        ),
      })
      .parse(data)
      .models.filter((m) => m.visibility === 'list')
      .map((m) => ({ id: m.slug, label: m.display_name })),
  }),
}
