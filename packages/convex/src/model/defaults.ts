import { inline } from '@sb/core/utils/strings'

import type { Doc } from '../_generated/dataModel'
import { generateId } from '../lib/utils'
import type { PromptItem } from '../types'
import type { ContextOptions } from '../types'
import type { InferenceParameters } from '../types'
import type { MathMode } from '../types'
import type { McpServer, WebSearchInstance } from '../types'

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

export const DEFAULT_PLAN_PROMPT = [
  inline`You are in plan mode. Your task is to research the conversation's current
    request and produce an implementation plan. Editing is NOT allowed in this mode.`,
  '',
  `- Explore using the available read-only tools and commands.`,
  inline`- Author the plan with the write_plan tool, and refine specific sections with
    edit_plan as your understanding deepens. Keep the plan concise, concrete, and
    actionable: context, approach, steps, critical files, verification.`,
  inline`- When the plan is ready, call exit_plan_mode to present it for approval. If
    approval is denied, keep researching and refining the plan.`,
].join('\n')

export const DEFAULT_SUBAGENT_PLAN_PROMPT = [
  inline`You are in plan mode, working on a task delegated by another agent.
    Editing is NOT allowed in this mode.`,
  '',
  `- Explore using the available read-only tools and commands.`,
  inline`- The session plan is shared with the delegating agent. Contribute to it with
    the write_plan and edit_plan tools when your task calls for it.`,
  inline`- You cannot exit plan mode or present the plan for approval. When done, write
    your findings as your final message. It is returned to the delegating agent as your
    report.`,
].join('\n')

export function createDefaultPlanPrompts(
  content: string = DEFAULT_PLAN_PROMPT,
): PromptItem[] {
  return [
    {
      id: 'default-plan-system',
      name: 'Prompt',
      role: 'system',
      content,
      enabled: true,
      visible: false,
      starter: false,
    },
    {
      id: 'default-plan-history',
      type: 'message-history',
    },
  ]
}

export function createDefaultImpersonationPrompts(): PromptItem[] {
  return [
    {
      id: 'default-impersonation-history',
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
      id: 'default-compaction-history',
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
  webSearchInstances: [] as WebSearchInstance[],
  mcpServers: [] as McpServer[],
  compactionPrompts: createDefaultCompactionPrompts(),
  impersonationPrompts: createDefaultImpersonationPrompts(),
  planPrompts: createDefaultPlanPrompts(),
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
$\`\`\`
if (ai && ai.toLowerCase() !== 'assistant') {
  return \`Your name is \${ai}.\`
}
\`\`\`
$\`\`\`
if (user) {
  return \`You refer to the user as \${user}.\`
}
\`\`\`
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
        id: generateId(),
        type: 'agents',
      },
      {
        id: generateId(),
        type: 'message-history',
      },
    ] satisfies PromptItem[],
    ...DEFAULT_CONTEXT_OPTIONS,
  }
}
