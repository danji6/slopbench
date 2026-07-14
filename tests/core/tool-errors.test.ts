/// <reference types="bun-types" />
import { collapseToolError } from '@sb/core/utils/tool-errors'
import { describe, expect, test } from 'bun:test'

describe('collapseToolError', () => {
  const issues = [
    {
      expected: 'string',
      code: 'invalid_type',
      path: ['path'],
      message: 'path is required: a workspace-relative file path.',
    },
  ]

  test('collapses an embedded Zod payload to its message', () => {
    const raw = `Invalid input for tool edit_file: ${JSON.stringify(issues, null, 2)}`
    expect(collapseToolError(raw)).toBe(
      'path is required: a workspace-relative file path.',
    )
  })

  test('collapses a bare Zod issues array to its message', () => {
    expect(collapseToolError(JSON.stringify(issues))).toBe(
      'path is required: a workspace-relative file path.',
    )
  })

  test('joins multiple issue messages', () => {
    const multi = [
      { message: 'path is required.' },
      { message: 'content is required.' },
    ]
    expect(collapseToolError(JSON.stringify(multi))).toBe(
      'path is required.\ncontent is required.',
    )
  })

  test('passes a plain error message through unchanged', () => {
    expect(collapseToolError('Could not find the exact text.')).toBe(
      'Could not find the exact text.',
    )
  })

  test('leaves a message with a non-Zod bracket untouched', () => {
    expect(collapseToolError('failed at line [42]')).toBe('failed at line [42]')
  })
})
