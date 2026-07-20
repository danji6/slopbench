import { commandRegistry } from './registry'

commandRegistry.register({
  name: 'eval',
  requires: ['session', 'agent'],
  description:
    'Re-evaluate dynamic prompts and tools on the next agent invocation',
})
