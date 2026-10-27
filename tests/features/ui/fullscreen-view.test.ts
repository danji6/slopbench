/// <reference types="bun-types" />
import { FULLSCREEN_VIEW } from '@/hooks/fullscreen'
import { type ViewSegment, matchesViewSegment, parseViewPath } from '@/lib/view'
import { describe, expect, test } from 'bun:test'

const path = (search: string): ViewSegment[] => parseViewPath(search)

describe('matchesViewSegment', () => {
  test('matches the segment carrying the given value', () => {
    expect(
      matchesViewSegment(
        path('?view=full:composer'),
        FULLSCREEN_VIEW,
        'composer',
      ),
    ).toBe(true)
  })

  test('does not match another owner of the same segment', () => {
    const nested = path('?view=settings:prompts/prompt:p1/full:prompt')
    expect(matchesViewSegment(nested, FULLSCREEN_VIEW, 'prompt')).toBe(true)
    expect(matchesViewSegment(nested, FULLSCREEN_VIEW, 'reminder')).toBe(false)
    expect(matchesViewSegment(nested, FULLSCREEN_VIEW, 'composer')).toBe(false)
  })

  test('does not match when the segment is absent or has no value', () => {
    expect(
      matchesViewSegment(
        path('?view=settings:prompts'),
        FULLSCREEN_VIEW,
        'prompt',
      ),
    ).toBe(false)
    expect(
      matchesViewSegment(path('?view=full'), FULLSCREEN_VIEW, 'prompt'),
    ).toBe(false)
    expect(matchesViewSegment([], FULLSCREEN_VIEW, 'prompt')).toBe(false)
  })

  test('ignores how deep the segment sits', () => {
    expect(
      matchesViewSegment(
        path('?view=scripts:s1/full:script'),
        FULLSCREEN_VIEW,
        'script',
      ),
    ).toBe(true)
  })
})
