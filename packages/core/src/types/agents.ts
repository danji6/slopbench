import type { PromptItem, PromptSource } from './prompts'
import type { ContextOptions, InferenceParameters } from './providers'
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
  compactionPrompts?: PromptItem[]
  impersonationPrompts?: PromptItem[]
  planPrompts?: PromptItem[]
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

export type AgentMutableFields<AgentId extends string = string> = PromptSource &
  InferenceParameters &
  ContextOptions &
  OverridableFields & {
    tools?: unknown
    modelId?: string
    reasoningEffort?: string
    description?: string
    autoApprove?: AgentAutoApprove
    subAgents?: AgentSubAgents<AgentId>
  }

export type CreateAgentArgs<AgentId extends string = string> = Partial<
  AgentMutableFields<AgentId>
> & {
  name: string
}

export type UpdateAgentArgs<AgentId extends string = string> = Partial<
  AgentMutableFields<AgentId>
> & {
  agentId: AgentId
  name?: string
  /** Overridable field names to clear back to inherit. */
  unset?: string[]
}
