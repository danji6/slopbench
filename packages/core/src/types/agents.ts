import type { PromptItem, PromptOrdering, ReminderPrompt } from './prompts'
import type { ContextOptions } from './providers'
import type { ThemeSnapshot } from './theme'

export type ScrollMode = 'follow' | 'into-view'
export type MathMode = 'off' | 'single' | 'double'

/** Settings a user configures globally and an agent may override. */
export type OverridableFields = {
  scrollMode?: ScrollMode
  customCss?: string
  theme?: ThemeSnapshot
  mathMode?: MathMode
  chatWidth?: number
  shell?: string
}

/** Per-agent approvals merged into every session's approvals. */
export type AgentAutoApprove = {
  tools?: string[]
  shell?: string[]
}

export type AgentSubAgentsMode = 'allow' | 'deny'

/** Which owned agents an agent may spawn as sub-agents. */
export type AgentSubAgents<AgentId extends string = string> = {
  mode: AgentSubAgentsMode
  agentIds: AgentId[]
}

/**
 * Everything an agent stores on its own document. Prompts and reminders live in
 * separate tables.
 */
export type AgentMutableFields<AgentId extends string = string> =
  PromptOrdering &
    ContextOptions &
    OverridableFields & {
      /** Names of the tools the agent may call. */
      tools?: string[]
      description?: string
      libraryReminderIds?: string[]
      autoApprove?: AgentAutoApprove
      subAgents?: AgentSubAgents<AgentId>
    }

export type CreateAgentArgs<AgentId extends string = string> = Partial<
  AgentMutableFields<AgentId>
> & {
  name: string
  prompts?: PromptItem[]
  reminderPrompts?: ReminderPrompt[]
}

export type UpdateAgentArgs<AgentId extends string = string> = Partial<
  AgentMutableFields<AgentId>
> & {
  agentId: AgentId
  name?: string
  /** Field names to clear and inherit. */
  unset?: (keyof AgentMutableFields<AgentId>)[]
}
