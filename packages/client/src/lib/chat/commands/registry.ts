import type {
  CommandAvailabilityContext,
  CommandDefinition,
} from './types'

class CommandRegistry {
  private commands = new Map<string, CommandDefinition>()
  private aliases = new Map<string, string>()

  register(command: CommandDefinition): void {
    this.commands.set(command.name, command)
    for (const alias of command.aliases ?? []) {
      this.aliases.set(alias, command.name)
    }
  }

  get(
    name: string,
    context?: CommandAvailabilityContext,
  ): CommandDefinition | undefined {
    const command = this.commands.get(this.aliases.get(name) ?? name)
    if (!command || !this.isAvailable(command, context)) return undefined
    return command
  }

  list(context?: CommandAvailabilityContext): CommandDefinition[] {
    return [...this.commands.values()].filter((command) =>
      this.isAvailable(command, context),
    )
  }

  private isAvailable(
    command: CommandDefinition,
    context?: CommandAvailabilityContext,
  ): boolean {
    const requirements = command.requires
    if (!requirements || !context) return true
    if (requirements.includes('session') && !context.hasActiveSession) {
      return false
    }
    if (requirements.includes('agent') && !context.hasActiveAgent) {
      return false
    }
    return true
  }
}

export const commandRegistry = new CommandRegistry()
