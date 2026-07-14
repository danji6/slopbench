import { commandRegistry } from './registry'

commandRegistry.register({
  name: 'shortcuts',
  aliases: ['keys', 'help'],
  requires: ['session'],
  description: 'Show keyboard shortcuts',
})
