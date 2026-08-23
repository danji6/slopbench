import {
  APPROVAL_LABEL_MAX_LENGTH,
  formatAlwaysAllowLabel,
} from '@/lib/chat/approval-label'
import { describe, expect, test } from 'bun:test'

describe('approval labels', () => {
  test('preserves short labels', () => {
    expect(formatAlwaysAllowLabel(['node'])).toBe(
      'Allow for this session: `node`',
    )
  })

  test('collapses multiline payloads and truncates long labels', () => {
    const label = formatAlwaysAllowLabel([
      `python print('first')\n${'print("more") '.repeat(20)}`,
    ])

    expect(label).not.toContain('\n')
    expect(label.length).toBe(APPROVAL_LABEL_MAX_LENGTH)
    expect(label.endsWith('…')).toBe(true)
  })

  test('bounds labels containing several patterns', () => {
    const label = formatAlwaysAllowLabel([
      `tool-${'a'.repeat(60)}`,
      `other-${'b'.repeat(60)}`,
    ])

    expect(label.length).toBeLessThanOrEqual(APPROVAL_LABEL_MAX_LENGTH)
  })
})
