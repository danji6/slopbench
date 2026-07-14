import { commandRegistry } from './registry'

commandRegistry.register({
  name: 'resume',
  requires: ['session', 'agent'],
  description: 'Ask the agent to continue their last response.',
})
