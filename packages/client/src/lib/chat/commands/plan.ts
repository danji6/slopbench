import { commandRegistry } from './registry'

commandRegistry.register({
  name: 'plan',
  requires: ['session', 'agent'],
  description: 'Toggle plan mode (read-only research, then approve a plan)',
})
