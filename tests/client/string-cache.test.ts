/// <reference types="bun-types" />
import { StringCache } from '@sb/client/lib/shiki/string-cache'
import { describe, expect, test } from 'bun:test'

describe('StringCache', () => {
  test('evicts the least recently used entry by count', () => {
    const cache = new StringCache(2, 1_000)
    cache.set('a', 'one')
    cache.set('b', 'two')
    expect(cache.get('a')).toBe('one')

    cache.set('c', 'three')

    expect(cache.get('a')).toBe('one')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe('three')
  })

  test('bounds the retained byte size', () => {
    const cache = new StringCache(10, 19)
    cache.set('a', '1234')
    cache.set('b', '5678')

    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe('5678')
  })

  test('does not retain an entry larger than the whole budget', () => {
    const cache = new StringCache(10, 10)
    cache.set('large', 'payload')

    expect(cache.get('large')).toBeUndefined()
  })
})
