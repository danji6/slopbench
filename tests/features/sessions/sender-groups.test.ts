import { buildRows } from '@/lib/chat/rows'
import { messageDisplayRole } from '@/lib/chat/sender-groups'
import type { MessageRecord } from '@/lib/chat/types'
import type { UIMessage } from 'ai'
import { expect, test } from 'bun:test'

const record = {
  sender: { type: 'agent', id: 'code' },
} as MessageRecord
const report = {
  id: 'report',
  role: 'user',
  parts: [
    {
      type: 'shell-report',
      jobId: 'job',
      command: 'bun lint',
      status: 'done',
      exitCode: 0,
      text: 'Passed',
    },
  ],
} as unknown as UIMessage

test.each(['processing', 'done'] as const)(
  'keeps replies and background reports in one sender group (%s)',
  (status) => {
    const messages = [
      { id: 'before', role: 'assistant', parts: [], status: 'done' },
      report,
      {
        id: 'after',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Finished' }],
        status,
      },
    ] as UIMessage[]
    const rows = buildRows(
      messages.map((message) => message.id),
      (id) => messages.find((message) => message.id === id)!,
      () => record,
      (id) => ({
        duration: id === 'before' ? 109000 : id === 'after' ? 37000 : 0,
      }),
      { groupBySender: true },
    )

    expect(rows.filter((row) => row.kind === 'header')).toHaveLength(1)
    expect(
      rows.find((row) => row.messageId === report.id && row.kind === 'group'),
    ).toMatchObject({
      kind: 'group',
      grouped: true,
    })
    expect(rows.filter((row) => row.kind === 'footer')).toEqual([
      {
        kind: 'footer',
        key: 'f:after',
        messageId: 'after',
        ...(status === 'done' && { duration: 146000 }),
      },
    ])
    expect(report.role).toBe('user')
  },
)

const boundaries: Array<[string, MessageRecord]> = [
  [
    'another agent',
    { sender: { type: 'agent', id: 'other' } } as MessageRecord,
  ],
  ['a human', { sender: { type: 'user', id: 'human' } } as MessageRecord],
  ['a visible system note', { ...record, type: 'workspace' }],
]

test.each(boundaries)(
  'a report keeps its boundary with %s',
  (_label, boundaryRecord) => {
    const ids = ['before', report.id, 'after']
    const rows = buildRows(
      ids,
      (id) =>
        id === report.id
          ? report
          : {
              id,
              role: 'assistant',
              parts: [{ type: 'text', text: 'Reply' }],
            },
      (id) => (id === report.id ? boundaryRecord : record),
      undefined,
      { groupBySender: true },
    )
    expect(
      rows.filter((row) => row.kind === 'header').map((row) => row.messageId),
    ).toEqual(boundaryRecord.type ? ['before', 'after'] : ids)
  },
)

test('only presents agent shell reports as assistant activity', () => {
  expect(messageDisplayRole(report, record)).toBe('assistant')
  expect(messageDisplayRole(report, undefined)).toBe('user')
  expect(
    messageDisplayRole(report, {
      sender: { type: 'user', id: 'human' },
    } as MessageRecord),
  ).toBe('user')
  expect(messageDisplayRole({ ...report, role: 'system' }, record)).toBe(
    'system',
  )
  expect(
    messageDisplayRole(
      {
        ...report,
        parts: [{ type: 'text', text: 'A prompt from another agent' }],
      },
      record,
    ),
  ).toBe('user')
})
