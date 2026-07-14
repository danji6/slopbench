import { commandRegistry } from './registry'

commandRegistry.register({
  name: 'compact',
  aliases: ['summary', 'summarize'],
  requires: ['session', 'agent'],
  description: 'Summarize and compact conversation history',
  takesArgument: true,
})
