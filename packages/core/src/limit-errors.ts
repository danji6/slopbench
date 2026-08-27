import * as L from './limits'

type Limit = {
  /** What is capped, read as "<subject> limit exceeded". */
  subject: string
  max: number
  unit?: 'characters' | 'bytes'
  /** A hint for the model. */
  hint?: string
}

const LIMITS = {
  prompts: {
    subject: 'Prompts',
    max: L.MAX_SCOPE_PROMPTS,
  },
  promptContent: {
    subject: 'Prompt content',
    max: L.MAX_PROMPT_CONTENT_CHARS,
    unit: 'characters',
  },
  promptName: {
    subject: 'Prompt name',
    max: L.MAX_PROMPT_NAME_CHARS,
    unit: 'characters',
  },
  reminders: {
    subject: 'Reminders',
    max: L.MAX_SCOPE_PROMPTS,
  },
  reminderContent: {
    subject: 'Reminder content',
    max: L.MAX_PROMPT_CONTENT_CHARS,
    unit: 'characters',
  },
  reminderName: {
    subject: 'Reminder name',
    max: L.MAX_PROMPT_NAME_CHARS,
    unit: 'characters',
  },
  mcpServers: {
    subject: 'MCP servers',
    max: L.MAX_MCP_SERVERS,
  },
  providers: {
    subject: 'Providers',
    max: L.MAX_PROVIDERS,
  },
  providerModels: {
    subject: 'Models',
    max: L.MAX_PROVIDER_MODELS,
  },
  modelExtraParameters: {
    subject: 'Model extra parameters',
    max: L.MAX_MODEL_EXTRA_PARAMETERS_CHARS,
    unit: 'characters',
  },
  providerExtraHeaders: {
    subject: 'Provider extra headers',
    max: L.MAX_PROVIDER_EXTRA_HEADERS_CHARS,
    unit: 'characters',
  },
  webSearchInstances: {
    subject: 'Web search instances',
    max: L.MAX_WEB_SEARCH_INSTANCES,
  },
  environmentKeys: {
    subject: 'Session variables',
    max: L.MAX_ENVIRONMENT_KEYS,
  },
  environmentBytes: {
    subject: 'Session variables size',
    max: L.MAX_ENVIRONMENT_BYTES,
    unit: 'bytes',
  },
  todos: {
    subject: 'Todos',
    max: L.MAX_TODO_ITEMS,
  },
  todoContent: {
    subject: 'Todo content',
    max: L.MAX_TODO_CONTENT_CHARS,
    unit: 'characters',
  },
  planContent: {
    subject: 'Plan content',
    max: L.MAX_PLAN_CONTENT_CHARS,
    unit: 'characters',
    hint: 'Shorten it.',
  },
  customCss: {
    subject: 'Custom CSS',
    max: L.MAX_CUSTOM_CSS_CHARS,
    unit: 'characters',
  },
  shellPath: {
    subject: 'Shell path',
    max: L.MAX_SHELL_PATH_CHARS,
    unit: 'characters',
  },
  messagePart: {
    subject: 'Message part',
    max: L.MAX_MESSAGE_PART_BYTES,
    unit: 'bytes',
  },
  messageContent: {
    subject: 'Message content',
    max: L.MAX_SEGMENT_BYTES,
    unit: 'bytes',
  },
} as const satisfies Record<string, Limit>

export type LimitKey = keyof typeof LIMITS

export function limitError(key: LimitKey): string {
  const { subject, max, unit, hint } = LIMITS[key] as Limit
  const cap = unit ? `${max} ${unit}` : `${max}`
  return `${subject} limit exceeded (max: ${cap})${hint ? `. ${hint}` : ''}`
}
