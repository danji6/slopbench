import type {
  SessionListItem as CoreSessionListItem,
  SessionMember as CoreSessionMember,
  SessionParticipant as CoreSessionParticipant,
} from '@sb/core/types'
import type {
  McpServer,
  ModelProviderConfig,
  ToolApprovals,
} from '@sb/core/types'
import type { ReasoningUIPart } from 'ai'
import type { Infer } from 'convex/values'

import type { Doc, Id } from './_generated/dataModel'
import type { SpawnableAgent } from './model/agent/subagents'
import type { PromptSets } from './model/prompts'
import type * as V from './validators'

export type { Role } from './lib/roles'
export type * from '@sb/core/types'

export type StreamContext = {
  stream: Doc<'streams'>
  session: Doc<'sessions'>
  environment: Record<string, unknown>
  toolApprovals?: ToolApprovals
  agent: Doc<'agents'>
  invoker: Doc<'users'>
  invokerSettings: Doc<'settings'> | null
  owner: Doc<'users'>
  ownerSettings: Doc<'settings'> | null
  output: Doc<'messages'>
  settings: Doc<'settings'> | null
  /** Every prompt set the agent resolves to, from the `prompts` table. */
  prompts: PromptSets
  /** Enabled and disabled servers alike, joined with their credentials. */
  mcpServers: McpServer[]
  /** Providers joined with their credentials, for building the model client. */
  modelProviders: ModelProviderConfig[]
  plan: Doc<'plans'> | null
  sessionCache: Doc<'sessionCache'> | null
  spawnableAgents: SpawnableAgent[]
}

export type SessionMember = CoreSessionMember<
  Doc<'userSessions'>,
  Id<'avatars'>
>

export type SessionParticipant = CoreSessionParticipant<
  Id<'users'>,
  Id<'agents'>,
  Id<'avatars'>
>

/**
 * Payloads carried by the `messages.extra` field, keyed by the message `type`
 * that owns them.
 */
export type MessageExtra = {
  /** Snapshot of the reminder prompt that produced an injected message. */
  reminder: Infer<typeof V.reminderExtraValidator>
  /** Label of the workspace bound by the change, absent when unbound. */
  workspace: Infer<typeof V.workspaceExtraValidator>
  /** The announced session mode change. */
  mode: Infer<typeof V.modeExtraValidator>
  /** The announced invoked command, and how far it got. */
  command: Infer<typeof V.commandExtraValidator>
}

/** Reasoning parts persist how long the model spent thinking, in ms. */
export type ReasoningPart = ReasoningUIPart & { duration?: number }

export type CommandName = Infer<typeof V.commandNameValidator>
export type CommandStatus = Infer<typeof V.commandStatusValidator>
export type QueuedCommand = Infer<typeof V.queuedCommandValidator>

/** The projection the sidebar renders. */
export type SessionSummary = Pick<
  Doc<'sessions'>,
  | '_id'
  | '_creationTime'
  | 'title'
  | 'activeAgentId'
  | 'lastMessageAt'
  | 'lastMessagePreview'
  | 'firstMessagePreview'
>

export type SessionListItem = CoreSessionListItem<
  SessionSummary,
  Id<'users'>,
  Id<'agents'>,
  Id<'avatars'>
>

export type PromptScope = Infer<typeof V.promptScopeValidator>
export type ReminderScope = Infer<typeof V.reminderScopeValidator>
export type CredentialScope = Infer<typeof V.credentialScopeValidator>

export type SessionMode = Infer<typeof V.sessionModeValidator>
export type ApprovalMode = Infer<typeof V.approvalModeValidator>
export type PlanStatus = Infer<typeof V.planStatusValidator>
export type TodoStatus = Infer<typeof V.todoStatusValidator>
export type TodoItem = Infer<typeof V.todoItemValidator>

export type SettingsPatch = Infer<typeof V.settingsPatchArgsValidator>
export type SettingsKey = Infer<typeof V.settingsKeyValidator>
export type TokenUsage = Infer<typeof V.tokenUsageValidator>

export type SaveSessionCacheArgs = Infer<typeof V.saveSessionCacheArgsValidator>
export type SendMessageArgs = Infer<typeof V.sendMessageArgsValidator>
export type CreateAgentArgs = Infer<typeof V.createAgentArgsValidator>
export type UpdateAgentArgs = Infer<typeof V.updateAgentArgsValidator>
export type UpdateSessionArgs = Infer<typeof V.updateSessionArgsValidator>
export type CreateScriptArgs = Infer<typeof V.createScriptArgsValidator>
export type UpdateScriptArgs = Infer<typeof V.updateScriptArgsValidator>
export type ApproveToolArgs = Infer<typeof V.approveToolArgsValidator>
export type TerminalWriteArgs = Infer<typeof V.terminalWriteArgsValidator>
export type TerminalKillArgs = Infer<typeof V.terminalKillArgsValidator>
export type TerminalResizeArgs = Infer<typeof V.terminalResizeArgsValidator>
export type TerminalSessionArgs = Infer<typeof V.terminalSessionArgsValidator>
export type TerminalPollArgs = Infer<typeof V.terminalPollArgsValidator>
export type ImportSessionArgs = Infer<typeof V.importSessionArgsValidator>
export type MessageWindowArgs = Infer<typeof V.messagesWindowArgsValidator>
export type PartAddress = Infer<typeof V.partAddressValidator>
export type EditMessagePartArgs = Infer<typeof V.editMessagePartArgsValidator>
export type DeleteMessagePartsArgs = Infer<typeof V.deleteMessagePartsArgsValidator> // prettier-ignore
