import { z } from 'zod'

export const MAX_WEB_FETCH_LENGTH = 50_000

export const webFetchQuerySchema = z.object({
  url: z.string().url().describe('The URL to fetch and read as clean markdown'),
  query: z
    .string()
    .min(1)
    .optional()
    .describe('Optional focus query; keeps the most relevant content'),
  max_length: z.number().int().min(1).max(MAX_WEB_FETCH_LENGTH).optional(),
})

export type WebFetchQuery = z.infer<typeof webFetchQuerySchema>
