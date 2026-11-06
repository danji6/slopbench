import type { ShellReportPart } from '@/lib/chat/parts'
import { buildRows, segmentGroupsFor } from '@/lib/chat/rows'
import {
  findScrollContentRow,
  scrollRowAddress,
} from '@/lib/chat/scroll-address'
import type { MessageRecord } from '@/lib/chat/types'
import { resolveWindowScrollAnchor } from '@/lib/chat/window-scroll-anchor'
import { createWorkIdentity } from '@/lib/chat/work-layout'
import { projectWorkRows } from '@/lib/chat/work-rows'
import { summarizeWork } from '@/lib/chat/work-summary'
import type { ToolUIPart, UIMessage } from 'ai'
import { expect, test } from 'bun:test'
import { message, text, tool } from '~/tests/helpers/work-layout'

const agent = { sender: { type: 'agent', id: 'code' } } as MessageRecord
const command = {
  type: 'tool-shell',
  toolCallId: 'command',
  input: { command: 'bun lint' },
  state: 'output-available',
  output: { jobId: 'job', status: 'background' },
} satisfies ToolUIPart
const source = message(
  [tool('edit_file', 'edit', { path: 'file.ts' }), command],
  'source',
)
const reportPart = {
  type: 'shell-report',
  jobId: 'job',
  command: 'bun lint',
  status: 'done',
  exitCode: 0,
  text: 'Lint passed',
} satisfies ShellReportPart
const report = {
  id: 'report',
  role: 'user',
  parts: [reportPart],
} as unknown as UIMessage

function transcript(
  messages = [source, report],
  records: Record<string, MessageRecord> = {},
  groupBySender = true,
) {
  const getMessage = (id: string) =>
    messages.find((message) => message.id === id) ?? null
  const getMetadata = (id: string) => records[id] ?? agent
  const rows = buildRows(
    messages.map((message) => message.id),
    getMessage,
    getMetadata,
    undefined,
    { groupBySender },
  )
  const works = rows.filter((row) => row.kind === 'work')
  const project = (open = new Set<string>()) =>
    projectWorkRows(rows, {
      open,
      jobs: [],
      getMessage,
      getMetadata,
    })
  return { rows, works, project, getMessage, getMetadata }
}

test('a delayed report folds into its original work and retains its content address', () => {
  const { rows, works, project } = transcript()
  expect(works).toHaveLength(1)
  const owner = works[0]
  expect(summarizeWork(owner.work, segmentGroupsFor(source, agent))).toEqual({
    label: 'Edited 1 file, ran 1 command',
    failures: 0,
    running: true,
  })
  const child = rows.find((row) => row.messageId === report.id)!
  expect(child).toMatchObject({
    kind: 'group',
    messageId: report.id,
    segmentIndex: 0,
    groupIndex: 0,
    workId: owner.work.id,
  })
  expect(project().some((row) => row.messageId === report.id)).toBe(false)
  expect(project(new Set([owner.work.id]))).toContainEqual(child)
  expect(source.parts[1]).toMatchObject({ output: { status: 'background' } })
  expect(report.role).toBe('user')
})

test.each([
  ['done', 0],
  ['done', 1],
  ['failed', undefined],
  ['killed', undefined],
] as const)(
  'completion settles work without tool failures (%s, exit=%s)',
  (status, exitCode) => {
    const commandMessage = message([command], source.id)
    const completed = {
      ...report,
      parts: [{ ...reportPart, status, exitCode }],
    } as unknown as UIMessage
    const { works } = transcript([commandMessage, completed])
    expect(
      summarizeWork(works[0].work, segmentGroupsFor(commandMessage, agent)),
    ).toEqual({
      label: 'Ran 1 command',
      running: false,
      failures: 0,
    })
  },
)

test('completion preserves genuine tool failures recorded in metadata', () => {
  const commandMessage = message([command], source.id)
  const { works } = transcript([commandMessage, report])

  expect(
    summarizeWork(works[0].work, segmentGroupsFor(commandMessage, agent), [
      command.toolCallId,
    ]),
  ).toEqual({ label: 'Ran 1 command', running: false, failures: 1 })
})

test('matches job identity rather than the nearest summary or repeated command text', () => {
  const unrelated = message(
    [
      {
        ...command,
        toolCallId: 'another',
        output: { jobId: 'other', status: 'background' },
      },
    ],
    'unrelated',
  )
  const { rows, works } = transcript([
    source,
    message([text('Progress')], 'commentary'),
    unrelated,
    report,
  ])
  expect(works).toHaveLength(2)
  expect(works[0].work.reports).toHaveLength(1)
  expect(works[1].work.reports).toBeUndefined()
  expect(rows.find((row) => row.messageId === report.id)?.kind).toBe('group')
  expect(rows.findIndex((row) => row.messageId === report.id)).toBeLessThan(
    rows.findIndex((row) => row.messageId === 'commentary'),
  )
})

test.each([
  ['a user message', { sender: { type: 'user', id: 'user' } } as MessageRecord],
  [
    'another agent',
    { sender: { type: 'agent', id: 'other' } } as MessageRecord,
  ],
  ['a summary', { ...agent, type: 'summary' }],
] as const)('does not fold a report across %s', (_label, boundary) => {
  const { works } = transcript(
    [source, message([text()], 'boundary'), report],
    { boundary },
  )
  expect(works).toHaveLength(2)
  expect(works[0].work.reports).toBeUndefined()
  expect(works[1].messageId).toBe(report.id)
})

test('keeps association across hidden context notes and while the group is expanded', () => {
  const resolveWorkId = createWorkIdentity()
  const first = buildRows(
    [source.id],
    () => source,
    () => agent,
    undefined,
    { groupBySender: true, resolveWorkId },
  )
  const original = first.find((row) => row.kind === 'work')!
  const note = message([text()], 'note')
  const { works } = transcript([source, note, report], {
    note: { ...agent, type: 'workspace', hidden: true },
  })
  expect(works).toHaveLength(1)
  const next = buildRows(
    [source.id, report.id],
    (id) => (id === source.id ? source : report),
    () => agent,
    undefined,
    { groupBySender: true, resolveWorkId },
  )
  expect(next.find((row) => row.kind === 'work')?.key).toBe(original.key)
})

test.each([true, false])(
  'unloaded original commands still give reports addressable work (grouped=%s)',
  (grouped) => {
    const failedReport = {
      ...report,
      parts: [{ ...reportPart, exitCode: 1 }],
    } as unknown as UIMessage
    const { rows, works, project, getMessage, getMetadata } = transcript(
      [failedReport],
      {},
      grouped,
    )
    expect(works).toHaveLength(1)
    const row = works[0]
    expect(
      summarizeWork(row.work, segmentGroupsFor(failedReport, agent)),
    ).toEqual({ label: 'Ran 1 command', running: false, failures: 0 })
    expect(project().filter((row) => row.kind === 'group')).toHaveLength(0)
    expect(
      project(new Set([row.work.id])).some((row) => row.kind === 'group'),
    ).toBe(true)
    const address = scrollRowAddress(row, {
      getMessage,
      getMessageMetadata: getMetadata,
    })!
    expect(findScrollContentRow(project(), report.id, address)).toEqual(row)
    expect(findScrollContentRow(rows, report.id, address)?.kind).toBe('group')
    expect(resolveWindowScrollAnchor([{ row, top: 100 }], project())).toEqual({
      index: 1,
      top: 100,
    })
  },
)

test('separate sender headers retain independent report work groups', () => {
  expect(transcript([source, report], {}, false).works).toHaveLength(2)
})

test('matching only the selected version never mutates rows from an earlier build', () => {
  const first = transcript([source])
  const { works } = transcript()
  expect(first.works[0].work.reports).toBeUndefined()
  expect(works[0].work.reports).toHaveLength(1)
  const { works: changed } = transcript(
    [message([tool('shell', 'new')], source.id), report],
    { source: { ...agent, selectedVersion: 2 } },
  )
  expect(changed).toHaveLength(2)
})

test('source commentary remains a grouped continuation after inserting late output', () => {
  const withCommentary = message([...source.parts, text('Progress')], source.id)
  const { rows } = transcript([withCommentary, report])
  const reportIndex = rows.findIndex((row) => row.messageId === report.id)
  expect(rows[reportIndex + 1]).toMatchObject({
    kind: 'group',
    messageId: source.id,
    grouped: true,
  })
})
