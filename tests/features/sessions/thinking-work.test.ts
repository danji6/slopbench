import { segmentGroupsFor } from '@/lib/chat/rows'
import { buildWorkLayout, createWorkIdentity } from '@/lib/chat/work-layout'
import { createWorkExpansionStore } from '@/lib/chat/work-state'
import { summarizeWork } from '@/lib/chat/work-summary'
import { expect, test } from 'bun:test'
import {
  type Part,
  layout,
  message,
  project,
  text,
  thinking,
  tool,
} from '~/tests/helpers/work-layout'

test('a lone thought appears only in the header, even after a reply arrives', () => {
  const streaming = { type: 'reasoning', text: '', state: 'streaming' } as const
  for (const part of [streaming, { ...streaming, text: 'Streaming thought' }]) {
    expect(project(message([part]))).toMatchObject([
      { kind: 'header', reasoning: { groupIndex: 0 } },
    ])
  }

  expect(project(message([thinking(), text('Reply')]))).toMatchObject([
    { kind: 'header', reasoning: { groupIndex: 0 } },
    { kind: 'group', groupIndex: 1 },
  ])
})

test.each([tool('shell', 's'), thinking('second')])(
  'shows a summary as soon as another activity row joins: %j',
  (part) => {
    const initial = thinking('first')
    const msg = message([initial, text(''), { type: 'step-start' }, part])
    const folded = project(msg)
    expect(folded.map((row) => row.kind)).toEqual(['header', 'work'])
    expect(folded[1]).toMatchObject({
      work: { groups: [{ groupIndex: 0 }, { groupIndex: 3 }] },
    })

    const [work] = layout(msg).work
    const opened = project(msg, new Set([work.id]))
    expect(opened.slice(2)).toMatchObject([
      { kind: 'group', groupIndex: 0, workId: work.id },
      { kind: 'group', groupIndex: 3, workId: work.id },
    ])
  },
)

test('sums thinking time and retains streaming and unknown-duration labels', () => {
  const label = (parts: Part[]) => {
    const msg = message(parts)
    return summarizeWork(layout(msg).work[0], segmentGroupsFor(msg, undefined))
  }
  expect(
    label([thinking('first', 10_000), thinking('second', 62_000)]).label,
  ).toBe('Thought for 1m12s')
  expect(label([thinking('quick', 110)]).label).toBe('Thought for 0.11s')
  expect(label([thinking()]).label).toBe('Thought')
  expect(
    label([
      thinking('first', 10_000),
      tool('read_file', 'read', { path: 'notes.md' }),
      thinking('second', 62_000),
      tool('shell', 'command'),
    ]).label,
  ).toBe('Read 1 file, ran 1 command, thought for 1m12s')
  expect(label([tool('shell', 'command')]).label).toBe('Ran 1 command')
  expect(
    label([
      thinking('done', 60_000),
      { type: 'reasoning', text: 'In progress', state: 'streaming' },
    ]),
  ).toMatchObject({ label: 'Thinking…', running: true })
  expect(
    label([
      tool('read_file', 'read', { path: 'notes.md' }),
      { type: 'reasoning', text: 'In progress', state: 'streaming' },
    ]),
  ).toMatchObject({ label: 'Read 1 file, thinking…', running: true })
})

test('thinking work keeps its expansion when tool calls arrive', () => {
  const identity = createWorkIdentity()
  const initial = message([thinking()])
  const work = buildWorkLayout(
    initial,
    undefined,
    segmentGroupsFor(initial, undefined),
    identity,
  ).work[0]
  const state = createWorkExpansionStore()
  state.setOpen(work.id, true)
  const next = message([thinking('updated'), tool('shell', 's')])
  const extended = buildWorkLayout(
    next,
    undefined,
    segmentGroupsFor(next, undefined),
    identity,
  ).work[0]
  expect(extended.id).toBe(work.id)
  expect(extended.toolCallIds).toEqual(['s'])
  expect(state.getSnapshot().has(extended.id)).toBe(true)
})
