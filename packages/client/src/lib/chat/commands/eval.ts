import { commandRegistry } from './registry'

commandRegistry.register({
  name: 'eval',
  requires: ['session', 'agent'],
  description: 'Re-evaluate dynamic prompts on the next agent invocation',
})
