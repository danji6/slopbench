/// <reference types="bun-types" />
import type { Doc } from '@sb/convex/_generated/dataModel'
import { prefixSenderName } from '@sb/convex/actions/stream/history'
import type { UIMessage } from 'ai'
import { describe, expect, test } from 'bun:test'

const USER = 'user_1' as Doc<'users'>['_id']

function agent(overrides: Partial<Doc<'agents'>> = {}): Doc<'agents'> {
  return {
    _id: 'agent_self' as Doc<'agents'>['_id'],
    shareUserDisplayNames: true,
    shareAgentDisplayNames: false,
    maskOtherAgents: false,
    ...overrides,
  } as Doc<'agents'>
}

const stored = {
  sender: { type: 'user', id: USER },
  senderSnapshot: { name: 'Alice' },
} as Doc<'messages'>

describe('prefixSenderName with injected file blocks', () => {
  test('attaches the name to the user prose, not the file block', () => {
    const message: UIMessage = {
      id: 'm1',
      role: 'user',
      parts: [
        { type: 'text', text: '<file path="a.ts">\nconst x = 1\n</file>' },
        { type: 'text', text: 'help me edit @a.ts' },
      ],
    }

    const parts = prefixSenderName(message, stored, agent())
    expect(parts[0]).toEqual({
      type: 'text',
      text: '<file path="a.ts">\nconst x = 1\n</file>',
    })
    expect(parts[1]).toEqual({
      type: 'text',
      text: 'Alice: help me edit @a.ts',
    })
  })

  test('skips injected directory listings too', () => {
    const message: UIMessage = {
      id: 'm2',
      role: 'user',
      parts: [
        {
          type: 'text',
          text: '<directory path="src/">\nfoo.ts\nlib/\n</directory>',
        },
        { type: 'text', text: 'what is in @src/' },
      ],
    }

    const parts = prefixSenderName(message, stored, agent())
    expect(parts[0]).toEqual({
      type: 'text',
      text: '<directory path="src/">\nfoo.ts\nlib/\n</directory>',
    })
    expect(parts[1]).toEqual({
      type: 'text',
      text: 'Alice: what is in @src/',
    })
  })
})
