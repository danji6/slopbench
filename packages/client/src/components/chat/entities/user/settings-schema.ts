import { MCP_TRANSPORTS, SEARCH_ENGINE_IDS } from '@sb/core/types'
import { z } from 'zod/v4'

const searchEngineSchema = z.enum(SEARCH_ENGINE_IDS)

export const webSearchInstanceSchema = z.object({
  engine: searchEngineSchema,
  url: z.url(),
  _clientId: z.string().optional(),
})

const mcpTransportSchema = z.enum(MCP_TRANSPORTS)

export const mcpToolMetaSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  descriptionOverride: z.string().optional(),
  inputSchema: z.string().optional(),
})

export const mcpServerSchema = z.object({
  id: z.string(),
  label: z.string(),
  url: z.url(),
  transport: mcpTransportSchema,
  apiKey: z.string().optional(),
  enabled: z.boolean(),
  tools: z.array(mcpToolMetaSchema).optional(),
  _clientId: z.string().optional(),
})

export const modelEntrySchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  contextWindow: z.number().optional(),
})

export const providerSchema = z.object({
  id: z.string(),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  enabled: z.boolean(),
  models: z.array(modelEntrySchema),
  _clientId: z.string().optional(),
})

export const promptSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
  enabled: z.boolean(),
  visible: z.boolean(),
  starter: z.boolean().default(false),
})

export const promptMarkerSchema = z.object({
  id: z.string(),
  type: z.enum(['message-history', 'agents']),
})

export const promptItemSchema = z.union([promptSchema, promptMarkerSchema])

export const libraryPromptSchema = promptSchema.extend({
  createdAt: z.number().optional(),
})

export const reminderPromptSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
  enabled: z.boolean(),
  interval: z.number().int().min(1),
  eager: z.boolean().optional(),
})

export const overrideSchema = z.object({
  fonts: z.object({
    enabled: z.boolean(),
    uiFont: z.string(),
    chatFont: z.string(),
    monoFont: z.string(),
    chatFontSize: z.number(),
  }),
})

export const settingsFormSchema = z.object({
  displayName: z.string(),
  scrollMode: z.enum(['follow', 'into-view']),
  mathMode: z.enum(['off', 'single', 'double']),
  autoTitle: z.boolean(),
  invertSend: z.boolean(),
  groupBySender: z.boolean(),
  titleModel: z.string().nullable(),
  webSearchInstances: z.array(webSearchInstanceSchema),
  mcpServers: z.array(mcpServerSchema),
  uiFont: z.string(),
  chatFont: z.string(),
  monoFont: z.string(),
  chatFontSize: z.number(),
  override: overrideSchema,
  chatWidth: z.number(),
  customCss: z.string(),
  themeColor: z.string(),
  themeMode: z.enum(['system', 'light', 'dark']),
  globalPrompts: z.array(promptSchema),
  libraryPrompts: z.array(libraryPromptSchema),
  reminderPrompts: z.array(reminderPromptSchema),
  compactionPrompts: z.array(promptItemSchema),
  impersonationPrompts: z.array(promptItemSchema),
  planPrompts: z.array(promptItemSchema),
  providers: z.array(providerSchema).superRefine(providerRefinement),
})

export type SettingsFormValues = z.infer<typeof settingsFormSchema>
export type ProviderFormValues = z.infer<typeof providerSchema>
export type ModelEntryFormValues = z.infer<typeof modelEntrySchema>
export type LibraryPrompt = z.infer<typeof libraryPromptSchema>
export type WebSearchInstanceFormValues = z.infer<typeof webSearchInstanceSchema> // prettier-ignore
export type McpServerFormValues = z.infer<typeof mcpServerSchema>
export type McpToolMetaFormValues = z.infer<typeof mcpToolMetaSchema>

function providerRefinement(
  providers: z.infer<typeof providerSchema>[],
  ctx: z.RefinementCtx,
) {
  const seen = new Set<string>()
  providers.forEach((p, i) => {
    if (!p.id) return
    if (seen.has(p.id)) {
      ctx.addIssue({
        code: 'custom',
        message: `Provider "${p.id}" is already configured`,
        path: [i, 'id'],
      })
    }
    seen.add(p.id)
  })
}
