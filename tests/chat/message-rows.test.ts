/// <reference types="bun-types" />
import { buildRows, findToolRow } from '@/lib/chat'
import type { MessageRecord } from '@/lib/chat/types'
import type { UIMessage } from 'ai'
import { describe, expect, test } from 'bun:test'

const textPart = { type: 'text', text: 'hi' } as UIMessage['parts'][number]
const stepPart = { type: 'step-start' } as UIMessage['parts'][number]

function message(parts: UIMessage['parts']): UIMessage {
  return {
    id: 'message-1',
    role: 'assistant',
    parts,
  }
}

describe('message rows', () => {
  test('skips non-renderable step boundary parts', () => {
    const rows = buildRows(
      ['message-1'],
      () => message([textPart, stepPart, textPart]),
      () => undefined,
    )

    expect(rows).toEqual([
      {
        kind: 'header',
        key: 'h:message-1',
        messageId: 'message-1',
        reasoningGroupIndex: undefined,
      },
      {
        kind: 'group',
        key: 'g:message-1:s0:text:0',
        messageId: 'message-1',
        segmentIndex: 0,
        groupIndex: 0,
      },
      {
        kind: 'group',
        key: 'g:message-1:s0:text:2',
        messageId: 'message-1',
        segmentIndex: 0,
        groupIndex: 2,
      },
    ])
  })

  test('omits the footer row when it would render nothing', () => {
    const rows = buildRows(
      ['message-1'],
      () => message([textPart]),
      () => undefined,
    )

    expect(rows.some((row) => row.kind === 'footer')).toBe(false)
  })

  test.each([
    ['a duration', () => undefined, () => ({ duration: 1200 })],
    [
      'an error',
      () => ({ metadata: { error: 'boom' } }) as unknown as MessageRecord,
      () => undefined,
    ],
    [
      'multiple versions',
      () => ({ versionCount: 2 }) as unknown as MessageRecord,
      () => undefined,
    ],
  ])('keeps the footer row for %s', (_label, meta, partMeta) => {
    const rows = buildRows(
      ['message-1'],
      () => message([textPart]),
      meta,
      partMeta,
    )

    expect(rows.map((row) => row.key)).toContain('f:message-1')
  })

  test('a user-invoked shell command is one renderable group row', () => {
    const shellPart = {
      type: 'tool-shell',
      toolCallId: 'call-1',
      state: 'input-available',
      input: { command: 'ls -la' },
    } as unknown as UIMessage['parts'][number]

    const rows = buildRows(
      ['message-1'],
      () => ({ ...message([shellPart]), role: 'user' }),
      () => undefined,
    )

    expect(rows.map((row) => row.key)).toEqual([
      'h:message-1',
      'g:message-1:s0:tools:call-1',
    ])
  })

  test('a headerless message with nothing to render keeps its footer row', () => {
    // Grouped, so no header stands in for it — every message must keep at
    // least one row or seek/reveal can no longer address it
    const sender = {
      sender: { type: 'agent', id: 'agent_1' },
      versionCount: 1,
    } as unknown as MessageRecord

    const rows = buildRows(
      ['message-1', 'message-2'],
      (id) => ({ ...message([stepPart]), id }),
      () => sender,
      () => undefined,
      { groupBySender: true },
    )

    expect(rows.map((row) => row.key)).toEqual([
      'h:message-1',
      'f:message-2:grp',
    ])
  })
})

describe('segment rows', () => {
  const part = (text: string) =>
    ({ type: 'text', text }) as UIMessage['parts'][number]

  const meta = (
    segments: Array<{ index: number; partCount: number }>,
    hasOlderSegments = false,
  ) =>
    ({
      sender: { type: 'agent', id: 'agent_1' },
      selectedVersion: 1,
      versionCount: 1,
      segments,
      hasOlderSegments,
      hasNewerSegments: false,
    }) as unknown as MessageRecord

  test('keys group rows per segment with intra-segment indices', () => {
    const rows = buildRows(
      ['message-1'],
      () => message([part('a'), part('b'), part('c')]),
      () =>
        meta([
          { index: 0, partCount: 2 },
          { index: 1, partCount: 1 },
        ]),
    )

    expect(rows.map((row) => row.key)).toEqual([
      'h:message-1',
      'g:message-1:s0:text:0',
      'g:message-1:s0:text:1',
      'g:message-1:s1:text:0',
    ])
  })

  test('prepending older segments never changes existing keys', () => {
    // Only segments 2..3 loaded (older ones paged out)
    const before = buildRows(
      ['message-1'],
      () => message([part('c'), part('d')]),
      () =>
        meta(
          [
            { index: 2, partCount: 1 },
            { index: 3, partCount: 1 },
          ],
          true,
        ),
    )

    // Older segments 0..1 load in
    const after = buildRows(
      ['message-1'],
      () => message([part('a'), part('b'), part('c'), part('d')]),
      () =>
        meta([
          { index: 0, partCount: 1 },
          { index: 1, partCount: 1 },
          { index: 2, partCount: 1 },
          { index: 3, partCount: 1 },
        ]),
    )

    // The header stays pinned at the top of the turn in both states
    const [beforeHeader, ...beforeKeys] = before.map((row) => row.key)
    const afterKeys = after.map((row) => row.key)
    expect(afterKeys[0]).toBe(beforeHeader)
    // The previously loaded rows keep their identity (heights survive)
    expect(afterKeys.slice(-beforeKeys.length)).toEqual(beforeKeys)
  })

  test('the header owns leading reasoning only when the turn start is loaded', () => {
    const reasoning = {
      type: 'reasoning',
      text: 'thinking',
    } as UIMessage['parts'][number]
    const named = (hasOlder: boolean) =>
      ({
        ...meta([{ index: hasOlder ? 1 : 0, partCount: 2 }], hasOlder),
        senderName: 'Agent',
      }) as unknown as MessageRecord

    const complete = buildRows(
      ['message-1'],
      () => message([reasoning, part('answer')]),
      () => named(false),
    )
    expect(complete[0]).toMatchObject({
      kind: 'header',
      key: 'h:message-1:r',
      reasoningGroupIndex: 0,
    })

    const partial = buildRows(
      ['message-1'],
      () => message([reasoning, part('answer')]),
      () => named(true),
    )
    // Mid-turn reasoning is not the turn's opening thought
    expect(partial[0]).toMatchObject({ kind: 'header', key: 'h:message-1' })
    expect(partial[1]).toMatchObject({ kind: 'group', segmentIndex: 1 })
  })
})

describe('sender grouping', () => {
  const agentMeta = {
    sender: { type: 'agent', id: 'agent_1' },
    senderName: 'Agent',
    selectedVersion: 1,
    versionCount: 1,
  } as unknown as MessageRecord
  const otherAgentMeta = {
    ...agentMeta,
    sender: { type: 'agent', id: 'agent_2' },
  } as unknown as MessageRecord
  const summaryMeta = {
    ...agentMeta,
    type: 'summary',
  } as unknown as MessageRecord

  const getMessage = (id: string): UIMessage => ({
    id,
    role: 'assistant',
    parts: [textPart],
  })

  function rowsFor(
    metaById: Record<string, MessageRecord>,
    groupBySender: boolean,
  ) {
    return buildRows(
      Object.keys(metaById),
      getMessage,
      (id) => metaById[id],
      () => ({ duration: 1 }),
      { groupBySender },
    )
  }

  test('suppresses the header of consecutive same-sender messages', () => {
    const rows = rowsFor(
      { 'message-1': agentMeta, 'message-2': agentMeta },
      true,
    )

    expect(rows.map((row) => row.key)).toEqual([
      'h:message-1',
      'g:message-1:s0:text:0',
      'f:message-1',
      'g:message-2:s0:text:0:grp',
      'f:message-2',
    ])
    expect(rows[3]).toMatchObject({ grouped: true })
  })

  test('keeps headers when the option is off', () => {
    const rows = rowsFor(
      { 'message-1': agentMeta, 'message-2': agentMeta },
      false,
    )

    expect(rows.map((row) => row.key)).toEqual([
      'h:message-1',
      'g:message-1:s0:text:0',
      'f:message-1',
      'h:message-2',
      'g:message-2:s0:text:0',
      'f:message-2',
    ])
    // Keys differ between the on/off states so `rowKeysEqual` catches toggles
    expect(rows.every((row) => !row.key.endsWith(':grp'))).toBe(true)
  })

  test('a nameless sender still gets a header', () => {
    const namelessMeta = {
      ...agentMeta,
      senderName: undefined,
    } as unknown as MessageRecord

    const rows = rowsFor({ 'message-1': namelessMeta }, false)

    expect(rows.map((row) => row.key)).toContain('h:message-1')
  })

  test('a sender change breaks the group', () => {
    const rows = rowsFor(
      { 'message-1': agentMeta, 'message-2': otherAgentMeta },
      true,
    )

    expect(rows.map((row) => row.key)).toContain('h:message-2')
  })

  test('hidden messages render a single chip row', () => {
    const hiddenMeta = {
      ...agentMeta,
      hidden: true,
    } as unknown as MessageRecord

    const rows = rowsFor(
      { 'message-1': agentMeta, 'message-2': hiddenMeta },
      false,
    )

    expect(rows.filter((row) => row.messageId === 'message-2')).toEqual([
      { kind: 'hidden', key: 'hid:message-2', messageId: 'message-2' },
    ])
  })

  test('grouping stays stable across a hidden chip', () => {
    const hiddenMeta = {
      ...agentMeta,
      hidden: true,
    } as unknown as MessageRecord

    const rows = rowsFor(
      {
        'message-1': agentMeta,
        'message-2': hiddenMeta,
        'message-3': agentMeta,
      },
      true,
    )

    // The message after the chip still folds into the sender group
    expect(rows.map((row) => row.key)).not.toContain('h:message-3')
    expect(rows.some((row) => row.key.endsWith(':grp'))).toBe(true)
  })

  test('a summary breaks the group on both sides', () => {
    const rows = rowsFor(
      {
        'message-1': agentMeta,
        'message-2': summaryMeta,
        'message-3': agentMeta,
      },
      true,
    )

    // The summary itself never groups, and the message after it starts fresh
    expect(rows.map((row) => row.key)).toContain('h:message-3')
    expect(rows.some((row) => row.key.endsWith(':grp'))).toBe(false)
  })
})

describe('tool rows', () => {
  const shell = (id: string) =>
    ({
      type: 'tool-shell',
      toolCallId: id,
      state: 'output-available',
      input: { command: `echo ${id}` },
    }) as unknown as UIMessage['parts'][number]

  const meta = (segments: Array<{ index: number; partCount: number }>) =>
    ({
      sender: { type: 'agent', id: 'agent_1' },
      selectedVersion: 1,
      versionCount: 1,
      segments,
      hasOlderSegments: segments[0]?.index !== 0,
      hasNewerSegments: false,
    }) as unknown as MessageRecord

  function locate(
    parts: UIMessage['parts'],
    record: MessageRecord | undefined,
    toolCallId: string,
  ) {
    const target = message(parts)
    const rows = buildRows(
      ['message-1'],
      () => target,
      () => record,
    )
    return findToolRow(rows, target, record, toolCallId)
  }

  test('consecutive shell calls share the row they render in', () => {
    const parts = [shell('call-1'), shell('call-2')]

    // Grouped tools collapse into one row, so the row alone can't tell the
    // blocks apart: the seek falls back to the block's own element
    expect(locate(parts, undefined, 'call-1')?.key).toBe(
      'g:message-1:s0:tools:call-1',
    )
    expect(locate(parts, undefined, 'call-2')?.key).toBe(
      'g:message-1:s0:tools:call-1',
    )
  })

  test('a call resolves to the row of its own segment', () => {
    const parts = [textPart, shell('call-1'), shell('call-2')]
    const record = meta([
      { index: 0, partCount: 2 },
      { index: 1, partCount: 1 },
    ])

    // The segment break splits the run, so the second call rows on its own
    expect(locate(parts, record, 'call-2')).toMatchObject({
      key: 'g:message-1:s1:tools:call-2',
      segmentIndex: 1,
      groupIndex: 0,
    })
  })

  test('a call in an unloaded segment has no row', () => {
    const parts = [shell('call-2')]
    const record = meta([{ index: 1, partCount: 1 }])

    expect(locate(parts, record, 'call-1')).toBeUndefined()
  })
})
