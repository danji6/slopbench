import type { MessageRow } from '@/lib/chat/rows'
import {
  captureWindowScrollAnchor,
  resolveWindowScrollAnchor,
} from '@/lib/chat/window-scroll-anchor'
import { afterEach, expect, test } from 'bun:test'
import { setupDom } from '~/tests/setup/dom'

setupDom()
afterEach(() => document.body.replaceChildren())

function group(segmentIndex: number): MessageRow {
  return {
    kind: 'group',
    key: `g:m:s${segmentIndex}:text:0`,
    messageId: 'm',
    segmentIndex,
    groupIndex: 0,
  }
}

function mount(row: MessageRow, top: number, height = 100) {
  const item = document.createElement('div')
  item.dataset.rowKey = row.key
  const content = document.createElement('article')
  content.getBoundingClientRect = () => new DOMRect(0, top, 400, height)
  item.append(content)
  document.body.append(item)
}

test('anchors body content instead of a header that can move above older segments', () => {
  const rows: MessageRow[] = [
    { kind: 'header', key: 'h:m', messageId: 'm' },
    group(4),
  ]
  mount(rows[0], 80, 32)
  mount(rows[1], 112)
  const anchors = captureWindowScrollAnchor(document.body, rows, 64, 800)
  expect(anchors.map(({ row }) => row.kind)).toEqual(['group'])
  expect(
    resolveWindowScrollAnchor(anchors, [rows[0], group(0), rows[1]]),
  ).toEqual({ index: 2, top: 112 })
})

test('keeps partially obscured content offsets and ignores offscreen rows', () => {
  const rows = [group(0), group(1), group(2)]
  mount(rows[0], -12)
  mount(rows[1], 800)
  mount(rows[2], -200)
  const anchors = captureWindowScrollAnchor(document.body, rows, 64, 800)
  expect(anchors).toHaveLength(1)
  expect(resolveWindowScrollAnchor(anchors, rows)).toEqual({
    index: 0,
    top: -12,
  })
})

test('survives a sender grouping key change and uses content below its spacer', () => {
  const row = group(4)
  mount(row, 120)
  const item = document.body.firstElementChild!
  item.prepend(document.createElement('div'))
  const anchors = captureWindowScrollAnchor(document.body, [row], 64, 800)
  expect(
    resolveWindowScrollAnchor(anchors, [{ ...row, key: `${row.key}:grp` }]),
  ).toEqual({ index: 0, top: 120 })
})

test('matches work by its original tool calls when an older group takes its key', () => {
  const row: MessageRow = {
    kind: 'work',
    key: 'w:old',
    messageId: 'm',
    work: { id: 'old', toolCallIds: ['retained'], groups: [], partial: true },
  }
  const rows: MessageRow[] = [
    { ...row, work: { ...row.work, toolCallIds: ['older'] } },
    { ...row, key: 'w:new', work: { ...row.work, id: 'new' } },
  ]
  expect(resolveWindowScrollAnchor([{ row, top: 120 }], rows)).toEqual({
    index: 1,
    top: 120,
  })
})

test('uses another original visible row before treating the anchor as evicted', () => {
  const anchors = [
    { row: group(4), top: 100 },
    { row: group(5), top: 200 },
  ]
  expect(resolveWindowScrollAnchor(anchors, [group(0), group(5)])).toEqual({
    index: 1,
    top: 200,
  })
  expect(resolveWindowScrollAnchor(anchors, [group(0)])).toBeNull()
})
