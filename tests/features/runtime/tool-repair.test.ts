import { repairToolCall } from '@sb/convex/model/tool/repair'
import { describe, expect, test } from 'bun:test'

function toolCall(input: unknown, toolName = 'edit_file') {
  return {
    type: 'tool-call' as const,
    toolCallId: 'call_1',
    toolName,
    input: JSON.stringify(input),
  }
}

describe('repairToolCall (edit_file)', () => {
  test('wraps a flat { oldText, newText } pair into edits', () => {
    const repaired = repairToolCall(
      toolCall({ path: 'a.c', oldText: 'foo', newText: 'bar' }),
    )
    expect(JSON.parse(repaired?.input ?? '{}')).toEqual({
      path: 'a.c',
      edits: [{ oldText: 'foo', newText: 'bar' }],
    })
  })

  test('fills a lone edits[] entry from stray top-level oldText/newText', () => {
    const repaired = repairToolCall(
      toolCall({
        path: 'a.c',
        edits: [{ newText: 'bar' }],
        oldText: 'foo',
      }),
    )
    expect(JSON.parse(repaired?.input ?? '{}')).toEqual({
      path: 'a.c',
      edits: [{ oldText: 'foo', newText: 'bar' }],
    })
  })

  test('returns null when there is nothing to recover', () => {
    expect(repairToolCall(toolCall({}))).toBeNull()
  })

  test('returns null for a valid call unrelated to edit_file', () => {
    expect(repairToolCall(toolCall({}, 'write_file'))).toBeNull()
  })

  test('flattens edits nested one array per entry', () => {
    const repaired = repairToolCall(
      toolCall({
        path: 'a.c',
        edits: [
          [{ oldText: 'foo', newText: 'FOO' }],
          [{ oldText: 'bar', newText: 'BAR' }],
        ],
      }),
    )
    expect(JSON.parse(repaired?.input ?? '{}')).toEqual({
      path: 'a.c',
      edits: [
        { oldText: 'foo', newText: 'FOO' },
        { oldText: 'bar', newText: 'BAR' },
      ],
    })
  })

  test('leaves a multi-edit array with a missing entry unrepaired', () => {
    const repaired = repairToolCall(
      toolCall({
        path: 'a.c',
        edits: [{ oldText: 'foo', newText: 'bar' }, { newText: 'baz' }],
      }),
    )
    expect(repaired).toBeNull()
  })

  test('redirects a content-only call (no edits) to write_file', () => {
    const repaired = repairToolCall(
      toolCall({ path: 'NOTES.md', content: '# Notes\n\nSome text.' }),
    )
    expect(repaired?.toolName).toBe('write_file')
    expect(JSON.parse(repaired?.input ?? '{}')).toEqual({
      path: 'NOTES.md',
      content: '# Notes\n\nSome text.',
    })
  })

  test('returns null when neither edits nor content can be recovered', () => {
    expect(
      repairToolCall(toolCall({ path: 'a.c', summary: 'no edits here' })),
    ).toBeNull()
  })

  test('recovers a file_path alias into path', () => {
    const repaired = repairToolCall(
      toolCall({
        file_path: 'a.c',
        edits: [{ oldText: 'foo', newText: 'bar' }],
      }),
    )
    expect(JSON.parse(repaired?.input ?? '{}')).toEqual({
      path: 'a.c',
      edits: [{ oldText: 'foo', newText: 'bar' }],
    })
  })
})

describe('repairToolCall (write_file)', () => {
  test('recovers a file_path alias into path', () => {
    const repaired = repairToolCall(
      toolCall({ file_path: 'NOTES.md', content: '# Notes' }, 'write_file'),
    )
    expect(repaired?.toolName).toBe('write_file')
    expect(JSON.parse(repaired?.input ?? '{}')).toEqual({
      path: 'NOTES.md',
      content: '# Notes',
    })
  })

  test('returns null without a string content', () => {
    expect(
      repairToolCall(toolCall({ file_path: 'NOTES.md' }, 'write_file')),
    ).toBeNull()
  })
})

describe('repairToolCall (edit_plan)', () => {
  test('wraps a flat { oldText, newText } pair into edits', () => {
    const repaired = repairToolCall(
      toolCall({ oldText: 'foo', newText: 'bar' }, 'edit_plan'),
    )
    expect(repaired?.toolName).toBe('edit_plan')
    expect(JSON.parse(repaired?.input ?? '{}')).toEqual({
      edits: [{ oldText: 'foo', newText: 'bar' }],
    })
  })

  test('fills a lone edits[] entry from stray top-level oldText/newText', () => {
    const repaired = repairToolCall(
      toolCall({ edits: [{ newText: 'bar' }], oldText: 'foo' }, 'edit_plan'),
    )
    expect(JSON.parse(repaired?.input ?? '{}')).toEqual({
      edits: [{ oldText: 'foo', newText: 'bar' }],
    })
  })

  test('flattens edits nested one array per entry', () => {
    const repaired = repairToolCall(
      toolCall(
        {
          edits: [
            [{ oldText: 'foo', newText: 'FOO' }],
            [{ oldText: 'bar', newText: 'BAR' }],
          ],
        },
        'edit_plan',
      ),
    )
    expect(JSON.parse(repaired?.input ?? '{}')).toEqual({
      edits: [
        { oldText: 'foo', newText: 'FOO' },
        { oldText: 'bar', newText: 'BAR' },
      ],
    })
  })

  test('redirects a content-only call (no edits) to write_plan', () => {
    const repaired = repairToolCall(
      toolCall({ content: '# Plan\n\n1. Do things.' }, 'edit_plan'),
    )
    expect(repaired?.toolName).toBe('write_plan')
    expect(JSON.parse(repaired?.input ?? '{}')).toEqual({
      content: '# Plan\n\n1. Do things.',
    })
  })

  test('returns null when there is nothing to recover', () => {
    expect(repairToolCall(toolCall({}, 'edit_plan'))).toBeNull()
    expect(
      repairToolCall(toolCall({ summary: 'no edits here' }, 'edit_plan')),
    ).toBeNull()
  })
})
