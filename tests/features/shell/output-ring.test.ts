import { OutputRing } from '@sb/sidecar/shell/registry'
import { describe, expect, test } from 'bun:test'

process.env.CHAT_JOB_MODE = 'script'

process.env.CHAT_SIDECAR_DATA_DIR ??= process.cwd()

describe('output ring', () => {
  test('keeps absolute offsets across head drops', () => {
    const ring = new OutputRing()
    ring.append('a'.repeat(600_000))
    ring.append('b'.repeat(600_000))

    const read = ring.read(0)
    expect(read.start).toBeGreaterThan(0) // head dropped
    expect(read.end).toBe(1_200_000)
    expect(read.text.length).toBe(read.end - read.start)
    expect(read.text.endsWith('b')).toBe(true)

    const tail = ring.read(1_199_990)
    expect(tail.start).toBe(1_199_990)
    expect(tail.text).toBe('b'.repeat(10))
  })

  test('subscribe replays a snapshot then streams live appends', () => {
    const ring = new OutputRing()
    ring.append('abc')

    const seen: string[] = []
    const { initial, unsubscribe } = ring.subscribe(0, (c) => seen.push(c))
    expect(initial.text).toBe('abc')
    expect(initial.end).toBe(3)

    ring.append('def')
    ring.append('ghi')
    // No gap and no duplicate of the replayed snapshot.
    expect(seen).toEqual(['def', 'ghi'])

    unsubscribe()
    ring.append('xyz')
    expect(seen).toEqual(['def', 'ghi'])
  })

  test('subscribe from a mid offset snapshots only the tail', () => {
    const ring = new OutputRing()
    ring.append('hello world')

    const { initial } = ring.subscribe(6, () => {})
    expect(initial.text).toBe('world')
    expect(initial.start).toBe(6)
    expect(initial.end).toBe(11)
  })

  test('head-trim keeps a live subscriber contiguous but clamps new ones', () => {
    const ring = new OutputRing()
    const live: string[] = []
    ring.append('a'.repeat(600_000))
    ring.subscribe(0, (c) => live.push(c))

    ring.append('b'.repeat(600_000)) // 1.2M > 1M cap → head trimmed

    // The live subscriber saw the whole appended chunk, uninterrupted.
    expect(live).toHaveLength(1)
    expect(live[0].length).toBe(600_000)

    // A fresh subscriber from 0 is clamped to the retained tail.
    const { initial } = ring.subscribe(0, () => {})
    expect(initial.start).toBeGreaterThan(0)
    expect(initial.end).toBe(1_200_000)
  })
})
