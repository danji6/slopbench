/// <reference types="bun-types" />
import { hydrateLiveSegments } from '@/lib/chat/live-segments'
import { describe, expect, test } from 'bun:test'

const segment = (segmentIndex: number, text: string, live = false) => ({
  segmentIndex,
  parts: text ? [{ type: 'text', text }] : [],
  sizeBytes: text.length,
  ...(live && { live: true }),
})

const message = {
  _id: 'm1',
  selectedVersion: 2,
  segments: [segment(0, 'sealed'), segment(1, '', true)],
  sizeBytes: 6,
}

describe('hydrateLiveSegments', () => {
  test('replaces only the matching live placeholder', () => {
    const result = hydrateLiveSegments(
      [message],
      [
        {
          messageId: 'm1',
          selectedVersion: 2,
          segment: segment(1, 'growing'),
        },
      ],
    )

    expect(result[0].segments).toEqual([
      segment(0, 'sealed'),
      segment(1, 'growing', true),
    ])
    expect(result[0].sizeBytes).toBe(13)
  })

  test('ignores stale versions and pages without the placeholder', () => {
    const input = [message]
    const stale = hydrateLiveSegments(input, [
      {
        messageId: 'm1',
        selectedVersion: 1,
        segment: segment(1, 'stale'),
      },
    ])
    const historical = { ...message, segments: [segment(0, 'sealed')] }
    const outsidePage = hydrateLiveSegments(
      [historical],
      [
        {
          messageId: 'm1',
          selectedVersion: 2,
          segment: segment(1, 'live'),
        },
      ],
    )

    expect(stale).toBe(input)
    expect(outsidePage[0]).toBe(historical)
  })
})
