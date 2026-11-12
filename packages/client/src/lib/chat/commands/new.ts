import { commandRegistry } from './registry'

commandRegistry.register({
  name: 'new',
  aliases: ['reset'],
  requires: ['session'],
  description: 'Start again with fresh agent context',
})
