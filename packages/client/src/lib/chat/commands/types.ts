import type { SessionMessage } from '@/lib/chat'

export type CommandDefinition = {
  name: string
  aliases?: readonly string[]
  /** Requirements for this command to appear. Hidden if not satisfied. */
  requires?: readonly CommandRequirement[]
  description: string
  /** When true, the remaining composer text is consumed as the command argument. */
  takesArgument?: boolean
  /** When true, the command cannot run without a non-empty argument. */
  requiresArgument?: boolean
  execute?: (ctx: CommandContext) => Promise<void>
}

export type CommandRequirement = 'session' | 'agent'

export type CommandAvailabilityContext = {
  hasActiveSession: boolean
  hasActiveAgent: boolean
}

export type CommandContext = {
  readonly messages: SessionMessage[]
  sendMessage(content: string): void
}
