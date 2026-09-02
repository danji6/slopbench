import { PROMPT_MARKERS } from '@sb/convex/model/prompt/markers'
import { providerRequiresBaseURL } from '@sb/convex/model/provider/known'
import { parseModelExtraParameters } from '@sb/core/model-parameters'
import { parseProviderExtraHeaders } from '@sb/core/provider-headers'
import { REASONING_TIERS } from '@sb/core/types'
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
  nameOverride: z.string().optional(),
  description: z.string().optional(),
  descriptionOverride: z.string().optional(),
  inputSchema: z.string().optional(),
})

export const mcpServerSchema = z.object({
  id: z.string(),
  /** Set once the server exists in the database. */
  serverId: z.string().optional(),
  label: z.string(),
  url: z.url(),
  transport: mcpTransportSchema,
  apiKey: z.string().optional(),
  /** Whether a key is already set in the database. */
  hasKey: z.boolean().default(false),
  enabled: z.boolean(),
  tools: z.array(mcpToolMetaSchema).optional(),
  _clientId: z.string().optional(),
})

export const modelEntrySchema = z
  .object({
    id: z.string(),
    _clientId: z.string().optional(),
    label: z.string().optional(),
    contextWindow: z.number().optional(),
    reasoning: z
      .discriminatedUnion('type', [
        z.object({
          type: z.literal('effort'),
          efforts: z.array(z.enum(REASONING_TIERS)),
        }),
        z.object({
          type: z.literal('binary'),
          parameter: z.string().min(1, 'Parameter name is required'),
        }),
        z.object({ type: z.literal('none') }),
      ])
      .optional(),
    inference: z
      .object({
        temperature: z.number().optional(),
        topP: z.number().optional(),
        frequencyPenalty: z.number().optional(),
        presencePenalty: z.number().optional(),
        repeatPenalty: z.number().optional(),
      })
      .optional(),
    extraParameters: z.string().optional(),
  })
  .superRefine((model, ctx) => {
    try {
      parseModelExtraParameters(model.extraParameters)
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        path: ['extraParameters'],
        message: error instanceof Error ? error.message : 'Invalid JSON',
      })
    }
  })

export const providerSchema = z
  .object({
    id: z.string(),
    apiKey: z.string().optional(),
    hasKey: z.boolean().default(false),
    baseURL: z.string().optional(),
    extraHeaders: z.string().optional(),
    enabled: z.boolean(),
    models: z.array(modelEntrySchema),
    _clientId: z.string().optional(),
  })
  .superRefine((provider, ctx) => {
    if (providerRequiresBaseURL(provider.id) && !provider.baseURL?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseURL'],
        message: 'Base URL is required for this provider',
      })
    }

    try {
      parseProviderExtraHeaders(provider.extraHeaders)
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        path: ['extraHeaders'],
        message: error instanceof Error ? error.message : 'Invalid JSON',
      })
    }
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
  type: z.enum(PROMPT_MARKERS),
})

export const promptItemSchema = z.union([promptSchema, promptMarkerSchema])

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
  avatarSize: z.number(),
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
  shell: z.string(),
  themeColor: z.string(),
  themeMode: z.enum(['system', 'light', 'dark']),
  globalPrompts: z.array(promptSchema),
  libraryPrompts: z.array(promptSchema),
  libraryReminders: z.array(reminderPromptSchema),
  compactionPrompts: z.array(promptItemSchema),
  impersonationPrompts: z.array(promptItemSchema),
  providers: z.array(providerSchema).superRefine(providerRefinement),
})

export type SettingsFormValues = z.infer<typeof settingsFormSchema>
export type ProviderFormValues = z.infer<typeof providerSchema>
export type ModelEntryFormValues = z.infer<typeof modelEntrySchema>
export type LibraryPrompt = z.infer<typeof promptSchema>
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
