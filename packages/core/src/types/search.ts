import { z } from 'zod'

export const SEARCH_ENGINE_IDS = ['searxng'] as const

export type SearchEngineId = (typeof SEARCH_ENGINE_IDS)[number]

export const SEARCH_CATEGORIES = [
  'general',
  'news',
  'images',
  'videos',
  'science',
  'it',
  'files',
] as const

export const SEARCH_TIME_RANGES = ['day', 'week', 'month', 'year'] as const

export const MAX_WEB_SEARCH_RESULTS = 20

export const searchEngineSchema = z.enum(SEARCH_ENGINE_IDS)
export const searchCategorySchema = z.enum(SEARCH_CATEGORIES)
export const searchTimeRangeSchema = z.enum(SEARCH_TIME_RANGES)

export const webSearchInstanceSchema = z.object({
  engine: searchEngineSchema,
  url: z.string().url(),
})

export const webSearchQuerySchema = z.object({
  query: z.string().min(1).describe('Search query'),
  category: searchCategorySchema.optional(),
  language: z
    .string()
    .min(1)
    .optional()
    .describe('Optional search language code, such as en or en-US'),
  time_range: searchTimeRangeSchema.optional(),
  safesearch: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  page: z.number().int().min(1).optional(),
  max_results: z.number().int().min(1).max(MAX_WEB_SEARCH_RESULTS).optional(),
})

export const webSearchSchema = webSearchQuerySchema.extend({
  instances: z.array(webSearchInstanceSchema).min(1),
})

export type WebSearchInstance = z.infer<typeof webSearchInstanceSchema>
export type WebSearchQuery = z.infer<typeof webSearchQuerySchema>
export type WebSearchInput = z.infer<typeof webSearchSchema>

export const SUPPORTED_WEB_SEARCH_ENGINES = [
  {
    id: 'searxng',
    label: 'SearXNG',
  },
] as const satisfies readonly {
  id: SearchEngineId
  label: string
}[]

export function isSearchEngineId(value: unknown): value is SearchEngineId {
  return (
    typeof value === 'string' &&
    SEARCH_ENGINE_IDS.includes(value as SearchEngineId)
  )
}
