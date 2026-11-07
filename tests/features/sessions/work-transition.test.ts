import type { MessageRow } from '@/lib/chat/rows'
import { projectWorkRows } from '@/lib/chat/work-rows'
import {
  WORK_TRANSITION_MS,
  createWorkExpansionStore,
} from '@/lib/chat/work-state'
import { expect, test } from 'bun:test'

const rows: Extract<MessageRow, { kind: 'group' }>[] = [
  {
    kind: 'group',
    key: 'tool',
    messageId: 'm',
    segmentIndex: 0,
    groupIndex: 0,
    workId: 'work',
  },
]

function project(store: ReturnType<typeof createWorkExpansionStore>) {
  return projectWorkRows(rows, {
    open: store.getSnapshot(),
    transitions: store.getTransitions(),
    jobs: [],
    getMessage: () => null,
    getMetadata: () => undefined,
  })
}

test('retains original rows until the virtualizer finishes closing', () => {
  const store = createWorkExpansionStore()
  store.setOpen('work', true)
  store.setOpen('work', false, new Set(['tool']))
  expect(store.getSnapshot().has('work')).toBe(false)
  expect(project(store)[0]).toBe(rows[0])
  const closing = store.getTransitions().get('work')!
  expect(closing.phase).toBe('closing')
  store.finishClosing('work', closing)
  expect(project(store)).toEqual([])
  expect(store.getTransitions().size).toBe(0)
})

test('a delayed close cannot remove work after reopening or during a later close', () => {
  const store = createWorkExpansionStore()
  store.setOpen('work', true)
  store.setOpen('work', false, new Set(['tool']))
  const firstClose = store.getTransitions().get('work')!
  store.setOpen('work', true, new Set(['tool']))
  store.finishClosing('work', firstClose)
  expect(project(store)[0]).toBe(rows[0])
  expect(store.getTransitions().get('work')?.phase).toBe('opening')
  store.setOpen('work', false, new Set(['tool']))
  const secondClose = store.getTransitions().get('work')!
  store.finishClosing('work', firstClose)
  expect(project(store)[0]).toBe(rows[0])
  store.finishClosing('work', secondClose)
  expect(project(store)).toEqual([])
  expect(store.getTransitions().size).toBe(0)
})

test('nonanimated changes remove rows immediately and cancel a pending animation', () => {
  const store = createWorkExpansionStore()
  store.setOpen('work', true, new Set())
  store.setOpen('work', false)
  expect(project(store)).toEqual([])
  expect(store.getTransitions().size).toBe(0)
})

test('closing does not mount offscreen work rows', () => {
  const store = createWorkExpansionStore()
  store.setOpen('work', true)
  store.setOpen('work', false, new Set())
  expect(project(store)).toEqual([])
  expect(store.getTransitions().size).toBe(0)
  store.setOpen('work', true)
})

test('mounts children before revealing them without changing their row identities', async () => {
  const store = createWorkExpansionStore()
  store.setOpen('work', true, new Set())
  const preparing = store.getTransitions().get('work')!
  expect(preparing.phase).toBe('preparing')
  expect(project(store)[0]).toBe(rows[0])
  store.startOpening('work', preparing)
  expect(store.getTransitions().get('work')?.phase).toBe('opening')
  expect(project(store)[0]).toBe(rows[0])
  await Bun.sleep(WORK_TRANSITION_MS + 50)
  expect(store.getTransitions().size).toBe(0)
  expect(project(store)[0]).toBe(rows[0])
})

test('a delayed preparation callback cannot reopen canceled work', () => {
  const store = createWorkExpansionStore()
  store.setOpen('work', true, new Set())
  const preparing = store.getTransitions().get('work')!
  store.setOpen('work', false, new Set(['tool']))
  store.startOpening('work', preparing)
  expect(project(store)).toEqual([])
  expect(store.getTransitions().size).toBe(0)
})
