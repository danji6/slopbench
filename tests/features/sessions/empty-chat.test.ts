import { resolveWelcomeView } from '@/lib/chat/empty-chat'
import { expect, test } from 'bun:test'

const ready = {
  providersLoaded: true,
  hasProviders: true,
  selectionLoaded: true,
  hasAgent: true,
  promptsLoaded: true,
  hasPrompts: false,
  folderLoaded: true,
}

test('provider setup overrides agent selection and configured prompts', () => {
  expect(
    resolveWelcomeView({ ...ready, hasProviders: false, hasPrompts: true }),
  ).toBe('providers')
  expect(
    resolveWelcomeView({ ...ready, hasProviders: false, hasAgent: false }),
  ).toBe('providers')
})

test('welcome waits for dependencies and preserves configured prompts', () => {
  for (const key of [
    'providersLoaded',
    'selectionLoaded',
    'promptsLoaded',
    'folderLoaded',
  ] as const) {
    expect(resolveWelcomeView({ ...ready, [key]: false })).toBe('loading')
  }
  expect(resolveWelcomeView({ ...ready, hasPrompts: true })).toBe('prompts')
  expect(resolveWelcomeView({ ...ready, hasAgent: false })).toBe('agents')
  expect(resolveWelcomeView(ready)).toBe('starters')
})
