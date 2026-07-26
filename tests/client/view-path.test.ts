/// <reference types="bun-types" />
import {
  type ViewSegment,
  findViewSegment,
  formatViewPath,
  parseViewPath,
  viewSearch,
  withViewSegment,
  withoutViewSegment,
} from '@/lib/view'
import { describe, expect, test } from 'bun:test'

const NESTED: ViewSegment[] = [
  { name: 'settings', value: 'behavior' },
  { name: 'prompt', value: 'abc-123' },
]

describe('parseViewPath', () => {
  test('reads segments with and without values', () => {
    expect(parseViewPath('?view=scripts')).toEqual([{ name: 'scripts' }])
    expect(parseViewPath('view=settings:behavior/prompt:abc-123')).toEqual(
      NESTED,
    )
  })

  test('returns an empty path when the parameter is absent or empty', () => {
    expect(parseViewPath('')).toEqual([])
    expect(parseViewPath('?id=session-1')).toEqual([])
    expect(parseViewPath('?view=')).toEqual([])
  })

  test('ignores a leading question mark and other parameters', () => {
    expect(parseViewPath('?id=session-1&view=scripts:s1')).toEqual([
      { name: 'scripts', value: 's1' },
    ])
  })

  test('keeps separators inside an encoded value intact', () => {
    const path = [{ name: 'prompt', value: 'a/b:c' }]
    expect(parseViewPath(`?view=${formatViewPath(path)}`)).toEqual(path)
  })

  test('drops malformed segments rather than throwing', () => {
    expect(parseViewPath('?view=/settings:behavior//')).toEqual([
      { name: 'settings', value: 'behavior' },
    ])
    expect(parseViewPath('?view=%E0%A4%A')).toEqual([{ name: '%E0%A4%A' }])
  })

  test('treats an empty value as no value', () => {
    expect(parseViewPath('?view=scripts:')).toEqual([{ name: 'scripts' }])
  })
})

describe('formatViewPath', () => {
  test('round-trips through parseViewPath', () => {
    expect(parseViewPath(`?view=${formatViewPath(NESTED)}`)).toEqual(NESTED)
  })

  test('leaves readable separators unescaped', () => {
    expect(formatViewPath(NESTED)).toBe('settings:behavior/prompt:abc-123')
  })

  test('is empty for an empty path', () => {
    expect(formatViewPath([])).toBe('')
  })
})

describe('withViewSegment', () => {
  test('appends a segment that is not present', () => {
    expect(
      withViewSegment([{ name: 'settings', value: 'behavior' }], {
        name: 'prompt',
        value: 'abc-123',
      }),
    ).toEqual(NESTED)
  })

  test('replaces in place and drops nested segments by default', () => {
    expect(
      withViewSegment(NESTED, { name: 'settings', value: 'models' }),
    ).toEqual([{ name: 'settings', value: 'models' }])
  })

  test('keeps nested segments when asked', () => {
    expect(
      withViewSegment(
        NESTED,
        { name: 'settings', value: 'models' },
        { keepChildren: true },
      ),
    ).toEqual([
      { name: 'settings', value: 'models' },
      { name: 'prompt', value: 'abc-123' },
    ])
  })

  test('does not mutate the input path', () => {
    const original = [...NESTED]
    withViewSegment(NESTED, { name: 'settings', value: 'models' })
    expect(NESTED).toEqual(original)
  })
})

describe('withoutViewSegment', () => {
  test('drops the segment and everything below it', () => {
    expect(withoutViewSegment(NESTED, 'settings')).toEqual([])
    expect(withoutViewSegment(NESTED, 'prompt')).toEqual([
      { name: 'settings', value: 'behavior' },
    ])
  })

  test('is a no-op for an absent segment', () => {
    expect(withoutViewSegment(NESTED, 'agent')).toEqual(NESTED)
  })
})

describe('findViewSegment', () => {
  test('finds by name regardless of depth', () => {
    expect(findViewSegment(NESTED, 'prompt')).toEqual({
      name: 'prompt',
      value: 'abc-123',
    })
    expect(findViewSegment(NESTED, 'agent')).toBeUndefined()
  })
})

describe('viewSearch', () => {
  test('preserves the session id', () => {
    expect(viewSearch('?id=session-1', NESTED)).toBe(
      'id=session-1&view=settings:behavior/prompt:abc-123',
    )
  })

  test('replaces an existing view rather than appending one', () => {
    const search = 'id=session-1&view=scripts'
    expect(viewSearch(search, [{ name: 'agent', value: 'profile' }])).toBe(
      'id=session-1&view=agent:profile',
    )
  })

  test('removes the parameter entirely for an empty path', () => {
    expect(viewSearch('id=session-1&view=scripts', [])).toBe('id=session-1')
    expect(viewSearch('view=scripts', [])).toBe('')
  })
})
