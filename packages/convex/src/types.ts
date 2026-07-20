import type {
  SessionListItem as CoreSessionListItem,
  SessionMember as CoreSessionMember,
  SessionParticipant as CoreSessionParticipant,
} from '@sb/core/types'
import type { Infer } from 'convex/values'

import type { Doc, Id } from './_generated/dataModel'
import type { SpawnableAgent } from './model/agent/subagents'
import type * as V from './validators'

export type { Role } from './lib/roles'
export type * from '@sb/core/types'

export type StreamContext = {
  stream: Doc<'streams'>
  session: Doc<'sessions'>
  agent: Doc<'agents'>
  invoker: Doc<'users'>
  invokerSettings: Doc<'settings'> | null
  owner: Doc<'users'>
  ownerSettings: Doc<'settings'> | null
  output: Doc<'messages'>
  settings: Doc<'settings'> | null
  plan: Doc<'plans'> | null
  sessionCache: Doc<'sessionCache'> | null
  spawnableAgents: SpawnableAgent[]
}

export type SessionMember = CoreSessionMember<
  Doc<'userSessions'>,
  Doc<'users'>,
  Doc<'settings'>
>

export type SessionParticipant = CoreSessionParticipant<
  Id<'users'>,
  Id<'agents'>,
  Id<'avatars'>
>

/**
 * Payloads carried by the `messages.extra` field, keyed by the message `type`
 * that owns them. We deliberately bypass validation to allow any shape here.
 */
export type MessageExtra = {
  /** Snapshot of the reminder prompt that produced an injected message. */
  reminder: { id: string; name: string }
}

export type SessionListItem = CoreSessionListItem<
  Doc<'sessions'>,
  Id<'users'>,
  Id<'agents'>,
  Id<'avatars'>
>

export type SessionMode = Infer<typeof V.sessionModeValidator>
export type PlanStatus = Infer<typeof V.planStatusValidator>
export type TodoStatus = Infer<typeof V.todoStatusValidator>
export type TodoItem = Infer<typeof V.todoItemValidator>

export type SaveSessionCacheArgs = Infer<
  typeof V.saveSessionCacheArgsValidator
>
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
export type DeleteMessagePartsArgs = Infer<
  typeof V.deleteMessagePartsArgsValidator
>
