import { shiftsOnlyAtStart } from '@/lib/chat/window-row-shift'
import { expect, test } from 'bun:test'

const rows = (...keys: string[]) => keys.map((key) => ({ key }))

test('preserves suffix measurements when older rows replace the leading sender header', () => {
  const before = rows('header', 'work', 'text', 'next')
  const after = rows(
    'older-header',
    'older-text',
    'grouped-work',
    'text',
    'next',
  )
  expect(shiftsOnlyAtStart(before, after)).toBe(true)
  expect(shiftsOnlyAtStart(after, before)).toBe(true)
})

test('does not shift measurements when pagination evicts newer rows', () => {
  expect(
    shiftsOnlyAtStart(rows('current', 'newer'), rows('older', 'current')),
  ).toBe(false)
})

test('does not shift measurements for work expansion inside the retained window', () => {
  expect(
    shiftsOnlyAtStart(
      rows('before', 'work', 'after'),
      rows('before', 'work', 'tool', 'after'),
    ),
  ).toBe(false)
  expect(shiftsOnlyAtStart(rows('same'), rows('same'))).toBe(false)
})
