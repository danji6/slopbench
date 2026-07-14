import { commandRegistry } from './registry'

commandRegistry.register({
  name: 'impersonate',
  aliases: ['user'],
  requires: ['session', 'agent'],
  description: 'Task the AI respond on your behalf',
  takesArgument: true,
})
