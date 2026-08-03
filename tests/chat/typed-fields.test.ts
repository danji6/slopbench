/// <reference types="bun-types" />
import * as V from '@sb/convex/validators'
import { describe, expect, test } from 'bun:test'
import { validate } from 'convex-helpers/validators'

/** Every payload the note/command writers produce, as they produce it. */
const EXTRAS = {
  reminder: { id: 'rem_1', name: 'Stand-up' },
  workspace: { label: 'slopbench' },
  unboundWorkspace: {},
  mode: { from: 'normal', to: 'plan' },
  command: { name: 'compact', status: 'ran' },
  failedCommand: {
    name: 'eval',
    argument: '2 + 2',
    status: 'failed',
    error: 'boom',
  },
} as const

describe('messages.extra', () => {
  for (const [name, extra] of Object.entries(EXTRAS)) {
    test(`accepts the ${name} payload its writer produces`, () => {
      expect(validate(V.messageExtraValidator, extra)).toBe(true)
    })
  }

  test('rejects a payload with a stray key', () => {
    const extra = { ...EXTRAS.reminder, role: 'system' }
    expect(validate(V.messageExtraValidator, extra)).toBe(false)
  })

  test('rejects a command status outside the union', () => {
    const extra = { name: 'compact', status: 'running' }
    expect(validate(V.messageExtraValidator, extra)).toBe(false)
  })
})

describe('metadata.usage', () => {
  test('accepts the three resolved counts', () => {
    const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
    expect(validate(V.tokenUsageValidator, usage)).toBe(true)
  })

  test('rejects raw provider keys beside the counts', () => {
    const usage = {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      reasoningTokens: 3,
    }

    expect(validate(V.tokenUsageValidator, usage)).toBe(false)
  })
})

describe('settings args', () => {
  test('accepts the patch the settings form submits', () => {
    const patch = {
      displayName: 'Me',
      chatFontSize: 15,
      customCss: 'body{}',
      recentWorkspaces: ['/tmp'],
    }

    expect(validate(V.settingsPatchArgsValidator, patch)).toBe(true)
  })

  test('rejects a field outside the settings row', () => {
    const patch = { ownerId: 'users_1' }
    expect(validate(V.settingsPatchArgsValidator, patch)).toBe(false)
  })

  test('rejects a value of the wrong type', () => {
    const patch = { customCss: { length: 1 } }
    expect(validate(V.settingsPatchArgsValidator, patch)).toBe(false)
  })

  test('a clear can only target a field the patch allows', () => {
    expect(validate(V.settingsKeyValidator, 'recentAgentId')).toBe(true)
    expect(validate(V.settingsKeyValidator, 'ownerId')).toBe(false)
    expect(validate(V.settingsKeyValidator, 'avatarId')).toBe(false)
  })
})
