import { commandRegistry } from './registry'

commandRegistry.register({
  name: 'timeout',
  requires: ['session'],
  description: 'Stop the agent\'s turn after a timeout',
  takesArgument: true,
  requiresArgument: true,
})
