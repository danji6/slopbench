import { createMessageStore } from '@/lib/chat/message-store'
import {
  hasVisibleOlderContent,
  oldestLoadedBoundary,
} from '@/lib/chat/older-content'
import { projectWorkRows } from '@/lib/chat/work-rows'
import type { ShellJobSummary } from '@cv/core/types/tools'
import { expect, test } from 'bun:test'
import { entry, syncPage } from '~/tests/helpers/older-pages'
import { type Part, text, thinking, tool } from '~/tests/helpers/work-layout'

const store = createMessageStore()
const boundaryEntry = entry(9, [text('already visible')], 4)
syncPage(store, [boundaryEntry])
const before = oldestLoadedBoundary(store.getMessageMetaMap())!

function visible(
  older: ReturnType<typeof entry>[],
  open = new Set<string>(),
  jobs: ShellJobSummary[] = [],
) {
  syncPage(store, [
    ...older,
    ...(older.some((entry) => entry.message.id === boundaryEntry.message.id)
      ? []
      : [boundaryEntry]),
  ])
  const rows = projectWorkRows(store.getRows(), {
    open,
    jobs,
    getMessage: store.getMessage,
    getMetadata: store.getMessageMetadata,
  })
  return hasVisibleOlderContent(rows, before, store, open)
}

test('skips collapsed work across messages, senders, and invisible parts', () => {
  expect(
    visible([
      entry(1, [
        tool('shell', 'a'),
        thinking(),
        text(''),
        { type: 'step-start' },
      ]),
      entry(2, [tool('read_file', 'b')]),
      entry(3, [thinking()]),
    ]),
  ).toBe(false)
})

test.each<Part>([
  text('older text'),
  tool('ask', 'question'),
  tool('task', 'subagent'),
  { type: 'file', mediaType: 'image/png', url: 'attachment:image' },
  { type: 'file-link', path: 'a.ts' } as unknown as Part,
])('stops at visible older body content: %j', (part) => {
  expect(visible([entry(1, [part])])).toBe(true)
})

test.each<Part>([
  tool('shell', 'shell'),
  {
    type: 'shell-report',
    jobId: 'job',
    command: 'ls',
    status: 'done',
    text: 'done',
  } as unknown as Part,
])('counts work only when expanded: %j', (part) => {
  const older = entry(1, [part])
  expect(visible([older])).toBe(false)
  const work = store.getRows().find((row) => row.kind === 'work')!
  expect(
    visible([older], new Set([work.kind === 'work' ? work.work.id : ''])),
  ).toBe(true)
})

test('counts promoted waiting terminals', () => {
  expect(
    visible([entry(1, [tool('shell', 'shell')])], new Set(), [
      {
        jobId: 'job',
        command: 'sleep 60',
        background: false,
        exitCode: null,
        startedAt: 0,
        toolCallId: 'shell',
        status: 'running',
        waiting: true,
      } as ShellJobSummary,
    ]),
  ).toBe(true)
})

test('counts visible notes and errors, but ignores footer metadata', () => {
  const older = entry(1, [])
  older.record.hidden = true
  expect(visible([older])).toBe(true)
  older.record.hidden = false
  older.record.metadata = { error: 'failed' }
  expect(visible([older])).toBe(true)
  older.record.metadata = undefined
  older.record.versionCount = 2
  expect(visible([older])).toBe(false)
})

test('ignores overlapping text and compares segments inside one message', () => {
  expect(
    visible([entry(9, [tool('shell', 'older'), text('overlap')], 3)]),
  ).toBe(false)
  expect(visible([entry(9, [text('new older text')], 3)])).toBe(true)
})

test('uses database order rather than map insertion or display order', () => {
  syncPage(store, [entry(2, [text()]), entry(1, [text()])])
  expect(oldestLoadedBoundary(store.getMessageMetaMap())?._id).toBe('m1')
})
