/// <reference types="bun-types" />
import {
  anchorFromEnd,
  anchorFromStart,
  sliceTailByBudget,
} from '@/lib/chat/window-math'
import { describe, expect, test } from 'bun:test'

/** A message whose segments have the given sizes (indices 0..n). */
const msg = (segmentSizes: number[], hasOlderSegments = false) => ({
  sizeBytes: segmentSizes.reduce((sum, size) => sum + size, 0),
  segments: segmentSizes.map((sizeBytes, segmentIndex) => ({
    segmentIndex,
    sizeBytes,
  })),
  hasOlderSegments,
})

const sized = (sizes: number[]) => sizes.map((size) => msg([size]))

describe('sliceTailByBudget', () => {
  test('keeps the newest messages within the budget', () => {
    const page = sized([50, 30, 20, 10])

    // Walking from the tail: 10 + 20 + 30 = 60 fits, +50 overflows
    expect(sliceTailByBudget(page, 60)).toEqual(page.slice(1))
  })

  test('returns everything when the budget is not exceeded', () => {
    const page = sized([10, 10, 10])
    expect(sliceTailByBudget(page, 100)).toEqual(page)
  })

  test('always keeps at least one message', () => {
    const page = sized([10, 500])
    expect(sliceTailByBudget(page, 100)).toEqual(page.slice(1))
  })

  test('handles an empty page', () => {
    expect(sliceTailByBudget([], 100)).toEqual([])
  })

  test('trims the boundary message to a segment suffix', () => {
    const split = msg([40, 30, 20])
    const tail = msg([10])
    const page = [split, tail]

    // 10 fits; the split turn overflows but its last two segments fit
    const sliced = sliceTailByBudget(page, 60)

    expect(sliced).toHaveLength(2)
    expect(sliced[0]).toEqual({
      sizeBytes: 50,
      segments: [
        { segmentIndex: 1, sizeBytes: 30 },
        { segmentIndex: 2, sizeBytes: 20 },
      ],
      hasOlderSegments: true,
    })
    expect(sliced[1]).toBe(tail)
  })

  test('drops the boundary message when no segment suffix fits', () => {
    const split = msg([40, 30])
    const tail = msg([10])

    expect(sliceTailByBudget([split, tail], 15)).toEqual([tail])
  })
})

describe('anchorFromEnd', () => {
  test('lands one page-budget in from the newest end', () => {
    const messages = sized([10, 10, 10, 10])

    // 10 + 10 = 20 >= 20 at index 2
    expect(anchorFromEnd(messages, 20)).toEqual({ index: 2, segmentIndex: 0 })
  })

  test('clamps to the oldest message when the budget exceeds the window', () => {
    expect(anchorFromEnd(sized([10, 10]), 1000)).toEqual({ index: 0 })
  })

  test('an oversized newest message anchors at itself', () => {
    const messages = sized([10, 500])
    expect(anchorFromEnd(messages, 100)).toEqual({ index: 1, segmentIndex: 0 })
  })

  test('an oversized split turn anchors mid-message', () => {
    const messages = [msg([10]), msg([50, 60, 70])]

    // Walking back: seg2 (70) + seg1 (60) = 130 >= 100
    expect(anchorFromEnd(messages, 100)).toEqual({
      index: 1,
      segmentIndex: 1,
    })
  })

  test('stays in range for a single message', () => {
    expect(anchorFromEnd(sized([5]), 100)).toEqual({ index: 0 })
  })
})

describe('anchorFromStart', () => {
  test('lands one page-budget in from the oldest end', () => {
    const messages = sized([10, 10, 10, 10])
    expect(anchorFromStart(messages, 20)).toEqual({ index: 1, segmentIndex: 0 })
  })

  test('clamps to the newest message when the budget exceeds the window', () => {
    expect(anchorFromStart(sized([10, 10]), 1000)).toEqual({ index: 1 })
  })

  test('an oversized oldest message anchors at itself', () => {
    const messages = [msg([500]), msg([10])]
    expect(anchorFromStart(messages, 100)).toEqual({
      index: 0,
      segmentIndex: 0,
    })
  })

  test('an oversized split turn anchors mid-message', () => {
    const messages = [msg([50, 60, 70]), msg([10])]

    // Walking forward: seg0 (50) + seg1 (60) = 110 >= 100
    expect(anchorFromStart(messages, 100)).toEqual({
      index: 0,
      segmentIndex: 1,
    })
  })
})
