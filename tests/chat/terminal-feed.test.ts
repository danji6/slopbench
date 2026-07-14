/// <reference types="bun-types" />
import {
  TERMINAL_GAP_MARKER,
  computeTerminalFeed,
} from '@/lib/terminal-feed'
import { describe, expect, test } from 'bun:test'

describe('computeTerminalFeed', () => {
  test('writes the whole tail on first feed', () => {
    expect(computeTerminalFeed(null, 'hello', 0)).toEqual({
      data: 'hello',
      writtenThrough: 5,
    })
  })

  test('writes only the delta on subsequent feeds', () => {
    expect(computeTerminalFeed(5, 'hello world', 0)).toEqual({
      data: ' world',
      writtenThrough: 11,
    })
  })

  test('writes deltas from a sliding window', () => {
    // term[0] is at absolute offset 4; 6 chars already written
    expect(computeTerminalFeed(6, 'o world', 4)).toEqual({
      data: 'world',
      writtenThrough: 11,
    })
  })

  test('returns null when nothing is new', () => {
    expect(computeTerminalFeed(11, 'hello world', 0)).toBeNull()
    expect(computeTerminalFeed(12, 'hello world', 0)).toBeNull()
  })

  test('marks a gap when the window slid past the written position', () => {
    const write = computeTerminalFeed(5, 'tail end', 100)
    expect(write?.data).toBe(`${TERMINAL_GAP_MARKER}tail end`)
    expect(write?.writtenThrough).toBe(108)
  })

  test('handles resumed mounts starting mid-stream', () => {
    // Fresh mount replays the persisted window in full, wherever it starts
    expect(computeTerminalFeed(null, 'late output', 5000)).toEqual({
      data: 'late output',
      writtenThrough: 5011,
    })
  })
})
