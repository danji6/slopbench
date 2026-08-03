import { inline } from '@sb/core/utils/strings'

import type { Doc } from '../_generated/dataModel'
import { generateId } from '../lib/utils'
import type { PromptItem } from '../types'
import type { ContextOptions } from '../types'
import type { InferenceParameters } from '../types'
import type { MathMode } from '../types'
import type { WebSearchInstance } from '../types'

// sourceColor copied from globals.css :root --md-source
export const SOURCE_COLOR = '#8a771d'

export const DEFAULT_COMPACTION_PROMPT = inline`
Your task for this turn is to create a complete summary of the entire
conversation. This summary should be thorough in capturing every detail
that would be essential for continuing without losing any context.
`

// We use 'user' role sentinel prompts because some providers forbid leading system prompts
export const DEFAULT_COMPACTION_SENTINEL_PROMPT = inline`
(TASK: Summarize this conversation according to the previous system instructions.)
`

export const DEFAULT_IMPERSONATION_PROMPT = inline`
Your task for this turn is to respond on behalf of {{user ?? 'the user'}}. Read the
conversation and write the next message in their own voice as if you were them.
`

export const DEFAULT_IMPERSONATION_SENTINEL_PROMPT = inline`
(TASK: Write {{user ?? 'the user'}}'s next message according to the previous system instructions.)
`

export function createDefaultImpersonationPrompts(): PromptItem[] {
  return [
    {
      type: 'agent-prompts',
    },
    {
      type: 'system-boundary',
    },
    {
      type: 'message-history',
    },
    {
      id: 'default-impersonation-prompt',
      name: 'Prompt',
      role: 'system',
      content: DEFAULT_IMPERSONATION_PROMPT,
      enabled: true,
      visible: false,
      starter: false,
    },
    {
      id: 'default-impersonation-sentinel',
      name: 'Sentinel',
      role: 'user',
      content: DEFAULT_IMPERSONATION_SENTINEL_PROMPT,
      enabled: true,
      visible: false,
      starter: false,
    },
  ]
}

export function createDefaultCompactionPrompts(): PromptItem[] {
  return [
    {
      type: 'agent-prompts',
    },
    {
      type: 'system-boundary',
    },
    {
      type: 'message-history',
    },
    {
      id: 'default-compaction-prompt',
      name: 'Prompt',
      role: 'system',
      content: DEFAULT_COMPACTION_PROMPT,
      enabled: true,
      visible: false,
      starter: false,
    },
    {
      id: 'default-compaction-sentinel',
      name: 'Sentinel',
      role: 'user',
      content: DEFAULT_COMPACTION_SENTINEL_PROMPT,
      enabled: true,
      visible: false,
      starter: false,
    },
  ]
}

export const DEFAULT_SETTINGS = {
  scrollMode: 'follow' as 'follow' | 'into-view',
  mathMode: 'single' as MathMode,
  autoTitle: true,
  invertSend: true,
  groupBySender: true,
  avatarSize: 48,
  webSearchInstances: [] as WebSearchInstance[],
  uiFont: 'Roboto',
  chatFont: 'Roboto',
  monoFont: 'Maple Mono',
  chatFontSize: 15,
  chatWidth: 800,
  customCss: '',
  themeMode: 'system' as 'light' | 'dark' | 'system',
} satisfies Partial<Doc<'settings'>>

/** Settings with all defaulted fields guaranteed to be present. */
export type ResolvedSettings = Omit<
  Doc<'settings'>,
  keyof typeof DEFAULT_SETTINGS
> & {
  [K in keyof typeof DEFAULT_SETTINGS]-?: NonNullable<
    Omit<Doc<'settings'>, 'ownerId'>[K]
  >
}

export const DEFAULT_INFERENCE_PARAMETERS: InferenceParameters = {
  temperature: 1,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  repeatPenalty: 1.1,
}

export const DEFAULT_CONTEXT_OPTIONS: ContextOptions = {
  trimContext: false,
  contextWindow: -1,
  outputTokens: -1,
  shareUserDisplayNames: false,
  shareAgentDisplayNames: false,
  maskOtherAgents: false,
}

export const DEFAULT_SYSTEM_PROMPT = `
You are a helpful assistant.

#if agent && agent.toLowerCase() !== 'assistant'
Your name is {{agent}}.
#endif

#if user
You refer to the user as {{user}}
#endif

#if fileExists('AGENTS.md')
The AGENTS.md file contains important project-specific instructions:
{{readFile('AGENTS.md')}}
#endif
`.trim()

export function createDefaultAgent() {
  return {
    name: 'Assistant',
    prompts: [
      {
        id: generateId(),
        name: 'System',
        role: 'system',
        content: DEFAULT_SYSTEM_PROMPT,
        enabled: true,
        visible: false,
        starter: false,
      },
      {
        type: 'system-boundary',
      },
      {
        type: 'message-history',
      },
    ] satisfies PromptItem[],
    ...DEFAULT_CONTEXT_OPTIONS,
  }
}
