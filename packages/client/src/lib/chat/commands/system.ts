import { commandRegistry } from './registry'

commandRegistry.register({
  name: 'system',
  aliases: ['sys'],
  description: 'Send a system message',
  takesArgument: true,
  requiresArgument: true,
})
