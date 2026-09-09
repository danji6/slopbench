import {
  buildRows,
  findToolRow,
  rowKeysEqual,
  segmentGroupsFor,
} from '@/lib/chat/rows'
import type { MessageRecord } from '@/lib/chat/types'
import { buildWorkLayout, createWorkIdentity } from '@/lib/chat/work-layout'
import { projectWorkRows } from '@/lib/chat/work-rows'
import { createWorkExpansionStore } from '@/lib/chat/work-state'
import { summarizeWork } from '@/lib/chat/work-summary'
import type { ShellJobSummary } from '@sb/core/types/tools'
import type { UIMessage } from 'ai'
import { describe, expect, test } from 'bun:test'

type Part = UIMessage['parts'][number]
const text = (text = 'commentary'): Part => ({ type: 'text', text })
const thinking = (text = 'thinking'): Part => ({
  type: 'reasoning',
  text,
  state: 'done',
})
const tool = (name: string, id: string, input: object = {}): Part =>
  ({
    type: `tool-${name}`,
    toolCallId: id,
    state: 'input-available',
    input,
  }) as Part
const message = (parts: Part[], id = 'm'): UIMessage => ({
  id,
  role: 'assistant',
  parts,
})
const meta = (parts: number[], start = 0): MessageRecord =>
  ({
    selectedVersion: 1,
    segments: parts.map((partCount, i) => ({ index: start + i, partCount })),
    hasOlderSegments: start > 0,
  }) as MessageRecord
function layout(msg: UIMessage, record?: MessageRecord) {
  return buildWorkLayout(msg, record, segmentGroupsFor(msg, record))
}
function rows(msg: UIMessage, record?: MessageRecord) {
  return buildRows(
    [msg.id],
    () => msg,
    () => record,
  )
}
function project(
  msg: UIMessage,
  open = new Set<string>(),
  jobs: ShellJobSummary[] = [],
  record?: MessageRecord,
) {
  return projectWorkRows(rows(msg, record), {
    open,
    jobs,
    getMessage: () => msg,
    getMetadata: () => record,
  })
}

describe('work stretches', () => {
  test('text separates runs while empty text and step boundaries do not', () => {
    const msg = message([
      text(),
      thinking(),
      tool('read_file', 'r', { path: 'a' }),
      text(''),
      { type: 'step-start' },
      tool('shell', 's'),
      text(),
      tool('edit_file', 'e'),
      text('done'),
    ])
    const result = layout(msg)
    expect(result.work.map((work) => work.toolCallIds)).toEqual([
      ['r', 's'],
      ['e'],
    ])
    expect(project(msg).map((row) => row.kind)).toEqual([
      'header',
      'group',
      'work',
      'group',
      'work',
      'group',
    ])
    expect(result.work[0].groups.map((group) => group.groupIndex)).toEqual([
      1, 2, 5,
    ])
  })

  test.each([
    tool('ask', 'q'),
    { type: 'file', mediaType: 'image/png', url: 'attachment:image' } as Part,
    { type: 'plan-link', snapshot: { status: 'draft' } } as unknown as Part,
    { type: 'file-link', path: 'a.ts' } as unknown as Part,
  ])('keeps questions and deliverables outside work', (separator) => {
    const result = layout(
      message([tool('shell', 'a'), separator, tool('shell', 'b')]),
    )
    expect(result.work).toHaveLength(2)
    expect(result.groups[1].workId).toBeUndefined()
  })

  test('thinking-only stretches never create body blocks', () => {
    const msg = message([thinking('old'), text(), thinking('latest')])
    expect(layout(msg).work).toHaveLength(0)
    expect(project(msg).map((row) => row.kind)).toEqual(['header', 'group'])
    expect(rows(msg)[0]).toMatchObject({
      reasoning: { messageId: 'm', segmentIndex: 0, groupIndex: 2 },
    })
    const mixed = message([
      thinking('isolated'),
      text(),
      thinking('kept'),
      tool('shell', 's'),
    ])
    expect(layout(mixed).work[0].groups).toHaveLength(2)
    expect(layout(mixed).groups.map((group) => group.groupIndex)).toEqual([
      1, 2, 3,
    ])
  })

  test('tools need no preceding text and streaming empty thinking still updates the header', () => {
    const msg = message([
      tool('shell', 's'),
      { type: 'reasoning', text: '', state: 'streaming' },
    ])
    expect(project(msg).map((row) => row.kind)).toEqual(['header', 'work'])
    expect(rows(msg)[0]).toMatchObject({ reasoning: { groupIndex: 1 } })
  })

  test('joins segments without replacing original child addresses', () => {
    const msg = message([
      thinking(),
      tool('read_file', 'a'),
      tool('shell', 'b'),
      text(),
    ])
    const record = meta([2, 2], 3)
    const result = layout(msg, record)
    expect(result.work).toHaveLength(1)
    expect(result.work[0].partial).toBe(true)
    expect(result.work[0].groups).toEqual([
      { segmentIndex: 3, groupIndex: 0 },
      { segmentIndex: 3, groupIndex: 1 },
      { segmentIndex: 4, groupIndex: 0 },
    ])
    expect(
      findToolRow(project(msg, new Set(), [], record), msg, record, 'b')?.kind,
    ).toBe('work')
  })

  test('does not mark an interior stretch as partial', () => {
    const msg = message([text(), tool('shell', 's'), text()])
    expect(
      layout(msg, { ...meta([3], 2), hasNewerSegments: true }).work[0].partial,
    ).toBe(false)
  })

  test('preserves user commands and typed reports', () => {
    const msg = message([tool('shell', 's')])
    expect(layout({ ...msg, role: 'user' }).work).toHaveLength(0)
    expect(layout(msg, { type: 'summary' } as MessageRecord).work).toHaveLength(
      0,
    )
  })
})

test('impersonated thinking appears only in the header while user tools stay inline', () => {
  const msg = {
    ...message([thinking(), tool('shell', 's'), text('on your behalf')]),
    role: 'user' as const,
  }
  expect(project(msg).map((row) => row.kind)).toEqual([
    'header',
    'group',
    'group',
  ])
  expect(rows(msg)[0]).toMatchObject({ reasoning: { groupIndex: 0 } })
  expect(layout(msg).groups.map((group) => group.groupIndex)).toEqual([1, 2])
  expect(layout(msg).work).toHaveLength(0)
})

test('typed messages without reasoning headers retain their body reasoning', () => {
  const msg = message([thinking(), text()])
  const record = { type: 'summary' } as MessageRecord
  expect(rows(msg, record).some((row) => row.kind === 'header')).toBe(false)
  expect(layout(msg, record).groups.map((group) => group.groupIndex)).toEqual([
    0, 1,
  ])
})

describe('work summaries', () => {
  test('deduplicates file paths per category, combines writes/edits, and excludes output polls', () => {
    const msg = message([
      tool('read_file', 'r1', { path: 'a' }),
      tool('read_file', 'r2', { path: 'a', offset: 10 }),
      tool('write_file', 'w', { path: 'a' }),
      tool('edit_file', 'e', { path: 'a' }),
      tool('edit_file', 'e2', { path: 'b' }),
      tool('shell', 's'),
      tool('shell_output', 'o'),
      tool('task', 't'),
    ])
    const result = summarizeWork(
      layout(msg).work[0],
      segmentGroupsFor(msg, undefined),
      ['e2'],
    )
    expect(result).toEqual({
      label: 'Read 1 file, edited 2 files, ran 1 command, 1 other tool call',
      failures: 1,
      running: true,
    })
  })

  test('keeps failed work folded and handles unknown inputs', () => {
    const msg = message([
      {
        ...tool('shell', 's'),
        state: 'output-error',
        errorText: 'failed',
      } as Part,
    ])
    expect(
      summarizeWork(layout(msg).work[0], segmentGroupsFor(msg, undefined)),
    ).toEqual({ label: 'Ran 1 command', running: false, failures: 1 })
    expect(project(msg).map((row) => row.kind)).toEqual(['header', 'work'])
    const pending = message([tool('edit_file', 'e')])
    expect(
      summarizeWork(
        layout(pending).work[0],
        segmentGroupsFor(pending, undefined),
      ).label,
    ).toBe('1 other tool call')
  })
})

describe('work visibility and identity', () => {
  test('expansion survives segment extension and is isolated by version', () => {
    const identity = createWorkIdentity()
    const initial = message([tool('shell', 'later')])
    const first = buildWorkLayout(
      initial,
      meta([1], 1),
      segmentGroupsFor(initial, meta([1], 1)),
      identity,
    ).work[0]
    const state = createWorkExpansionStore()
    state.setOpen(first.id, true)
    const extended = message([
      tool('read_file', 'earlier'),
      tool('shell', 'later'),
      tool('edit_file', 'new'),
    ])
    const record = meta([1, 2])
    const work = buildWorkLayout(
      extended,
      record,
      segmentGroupsFor(extended, record),
      identity,
    ).work[0]
    expect(work.id).toBe(first.id)
    expect(state.getSnapshot().has(work.id)).toBe(true)
    const nextVersion = buildWorkLayout(
      extended,
      { ...record, selectedVersion: 2 },
      segmentGroupsFor(extended, record),
      identity,
    ).work[0]
    expect(state.getSnapshot().has(nextVersion.id)).toBe(false)
    state.setOpen(work.id, false)
    expect(state.getSnapshot().size).toBe(0)
  })

  test('only waiting foreground terminals escape, retaining the group key', () => {
    const msg = message([tool('shell', 's1'), tool('shell', 's2')])
    const work = layout(msg).work[0]
    const job = {
      jobId: 'job',
      toolCallId: 's2',
      status: 'running',
      waiting: true,
      background: false,
    } as ShellJobSummary
    const closed = project(msg, new Set(), [job])
    const open = project(msg, new Set([work.id]), [job])
    expect(closed).toHaveLength(3)
    expect(closed[2]).toMatchObject({
      kind: 'group',
      promotedToolCallIds: ['s2'],
    })
    expect(open[2].key).toBe(closed[2].key)
    expect(open[2]).not.toHaveProperty('promotedToolCallIds')
    const closing = projectWorkRows(rows(msg), {
      open: new Set(),
      transitions: new Map([
        [
          work.id,
          {
            phase: 'closing',
            mountedRows: new Set([open[2].key]),
          },
        ],
      ]),
      jobs: [job],
      getMessage: () => msg,
      getMetadata: () => undefined,
    })
    expect(closing).toEqual(closed)
    for (const inactive of [
      { ...job, waiting: false },
      { ...job, background: true },
      { ...job, status: 'done' as const },
    ]) {
      expect(project(msg, new Set(), [inactive])).toHaveLength(2)
    }
  })

  test('does not promote an old terminal with a reused call id', () => {
    const msg = message([
      {
        ...tool('shell', 's'),
        state: 'output-available',
        output: { jobId: 'old', status: 'done' },
      } as Part,
    ])
    const job = {
      jobId: 'new',
      toolCallId: 's',
      status: 'running',
      waiting: true,
      background: false,
    } as ShellJobSummary
    expect(project(msg, new Set(), [job])).toHaveLength(2)
  })

  test('shared sender header follows the latest source, without changing its key', () => {
    const msgs = [
      message([thinking('first')], 'a'),
      message([thinking('second')], 'b'),
    ]
    const record = { sender: { type: 'agent', id: 'agent' } } as MessageRecord
    const grouped = buildRows(
      ['a', 'b'],
      (id) => msgs.find((m) => m.id === id)!,
      () => record,
      undefined,
      { groupBySender: true },
    )
    expect(grouped[0]).toMatchObject({
      key: 'h:a',
      messageId: 'a',
      reasoning: { messageId: 'b', segmentIndex: 0, groupIndex: 0 },
    })
    const changed = message([thinking('first'), text(), thinking('last')])
    expect(rows(changed)[0].key).toBe(
      rows(message([thinking('first'), text()]))[0].key,
    )
    expect(
      rowKeysEqual(
        [rows(changed)[0]],
        [rows(message([thinking('first'), text()]))[0]],
      ),
    ).toBe(false)
  })
})

test('reveals the original tool row after opening its enclosing work block', () => {
  const msg = message([text(), thinking(), tool('shell', 'target'), text()])
  const record = meta([2, 2], 3)
  const folded = project(msg, new Set(), [], record)
  const parent = findToolRow(folded, msg, record, 'target')
  expect(parent?.kind).toBe('work')
  if (parent?.kind !== 'work') throw new Error('Expected enclosing work')
  const opened = project(msg, new Set([parent.work.id]), [], record)
  expect(findToolRow(opened, msg, record, 'target')).toMatchObject({
    kind: 'group',
    segmentIndex: 4,
    groupIndex: 0,
  })
})

test('inserting a text separator splits work without duplicate identities', () => {
  const resolveId = createWorkIdentity()
  const initial = message([tool('shell', 'a'), tool('shell', 'b')])
  const joined = buildWorkLayout(
    initial,
    undefined,
    segmentGroupsFor(initial, undefined),
    resolveId,
  )
  const changed = message([tool('shell', 'a'), text(), tool('shell', 'b')])
  const split = buildWorkLayout(
    changed,
    undefined,
    segmentGroupsFor(changed, undefined),
    resolveId,
  )
  expect(split.work).toHaveLength(2)
  expect(split.work[0].id).toBe(joined.work[0].id)
  expect(split.work[0].id).not.toBe(split.work[1].id)
})
