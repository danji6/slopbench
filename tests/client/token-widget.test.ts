/// <reference types="bun-types" />
import { formatContextUsage } from '@/components/chat/widgets/token-widget'
import { expect, test } from 'bun:test'

test('formats context usage for the token widget tooltip', () => {
  expect(formatContextUsage(12_345, 128_000, 10)).toBe('12.3k/128k (10% used)')
})

test('formats an unknown context window as unlimited', () => {
  expect(formatContextUsage(12_345, undefined, 0)).toBe('12.3k/∞ (0% used)')
})
