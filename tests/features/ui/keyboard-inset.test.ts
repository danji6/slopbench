/// <reference types="bun-types" />
import { keyboardViewport } from '@/hooks/keyboard-inset'
import { describe, expect, test } from 'bun:test'

describe('keyboard viewport', () => {
  test('reports the visual height and the obscured layout bottom', () => {
    expect(
      keyboardViewport(800, {
        height: 500,
        offsetTop: 0,
      }),
    ).toEqual({ bottomInset: 300, height: 500 })
  })

  test('does not double-compensate browser viewport panning', () => {
    expect(
      keyboardViewport(800, {
        height: 500,
        offsetTop: 300,
      }),
    ).toEqual({ bottomInset: 0, height: 500 })
  })

  test('falls back cleanly without the visual viewport API', () => {
    expect(keyboardViewport(800)).toEqual({ bottomInset: 0 })
  })
})
