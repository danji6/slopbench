/// <reference types="bun-types" />
import {
  type PartGroup,
  fromAddressForGroup,
  groupPartAddresses,
  groupParts,
} from '@/lib/chat/parts'
import type { Doc, Id } from '@sb/convex/_generated/dataModel'
import type { Role } from '@sb/convex/lib/roles'
import { assertRangeDeletable } from '@sb/convex/model/chat'
import type { UIMessage } from 'ai'
import { describe, expect, test } from 'bun:test'

type Message = Doc<'messages'>
type Session = Doc<'sessions'>

function message(overrides: Partial<Message>): Message {
  return {
    status: 'done',
    sender: { type: 'agent', id: 'agent-1' },
    ...overrides,
  } as Message
}

function userMessage(userId: string, overrides: Partial<Message> = {}) {
  return message({
    sender: { type: 'user', id: userId } as Message['sender'],
    ...overrides,
  })
}

function caller(userId: string, role: Role) {
  return { userId: userId as Id<'users'>, role }
}

const session = { ownerId: 'owner-1' } as Session

describe('assertRangeDeletable', () => {
  test('allows agent messages and own user messages', () => {
    const range = [message({}), userMessage('member-1'), message({})]

    expect(() =>
      assertRangeDeletable(caller('member-1', 'user'), range, session),
    ).not.toThrow()
  })

  test('rejects the whole range when it contains another user message', () => {
    const range = [
      userMessage('member-1'),
      userMessage('member-2'),
      message({}),
    ]

    expect(() =>
      assertRangeDeletable(caller('member-1', 'user'), range, session),
    ).toThrow()
  })

  test('lets the session owner delete other user messages', () => {
    const range = [userMessage('member-1'), userMessage('member-2')]

    expect(() =>
      assertRangeDeletable(caller('owner-1', 'user'), range, session),
    ).not.toThrow()
  })

  test('lets a moderator delete other user messages', () => {
    const range = [userMessage('member-1'), userMessage('member-2')]

    expect(() =>
      assertRangeDeletable(caller('member-3', 'moderator'), range, session),
    ).not.toThrow()
  })

  test('rejects a range containing a processing message', () => {
    const range = [message({}), message({ status: 'processing' })]

    expect(() =>
      assertRangeDeletable(caller('owner-1', 'admin'), range, session),
    ).toThrow()
  })
})

const text = (text: string) => ({ type: 'text', text })
const read = (id: string) => ({
  type: 'tool-read_file',
  toolCallId: id,
  state: 'output-available',
})
const step = { type: 'step-start' }

function partsOf(...parts: object[]): UIMessage['parts'] {
  return parts as UIMessage['parts']
}

function groupAt(parts: UIMessage['parts'], index: number): PartGroup {
  const group = groupParts(parts)[index]
  if (!group) throw new Error(`no group at ${index}`)
  return group
}

describe('part addresses', () => {
  test('addresses a group of parts within its segment', () => {
    const parts = partsOf(text('a'), read('1'), step, read('2'), text('b'))

    expect(groupPartAddresses(2, parts, groupAt(parts, 1))).toEqual([
      { segmentIndex: 2, partIndex: 1 },
      { segmentIndex: 2, partIndex: 3 },
    ])
  })

  test('addresses a single group by its intra-segment index', () => {
    const parts = partsOf(text('a'), text('b'), text('c'))

    expect(groupPartAddresses(0, parts, groupAt(parts, 1))).toEqual([
      { segmentIndex: 0, partIndex: 1 },
    ])
  })

  test('fromAddressForGroup points at the group start', () => {
    const parts = partsOf(text('a'), read('1'), step, read('2'), text('b'))

    expect(fromAddressForGroup(1, groupAt(parts, 1))).toEqual({
      segmentIndex: 1,
      partIndex: 1,
    })
    expect(fromAddressForGroup(0, groupAt(parts, 2))).toEqual({
      segmentIndex: 0,
      partIndex: 4,
    })
  })
})
