import { commandRegistry } from './registry'

commandRegistry.register({
  name: 'assistant',
  aliases: ['agent', 'ai'],
  requires: ['agent'],
  description: 'Send a message on behalf of the active agent',
  takesArgument: true,
  requiresArgument: true,
})
