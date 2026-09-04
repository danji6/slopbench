import { commandRegistry } from './registry'

commandRegistry.register({
  name: 'autoCompact',
  requires: ['session', 'agent'],
  description: 'Compact after the active or next agent turn ends',
})
