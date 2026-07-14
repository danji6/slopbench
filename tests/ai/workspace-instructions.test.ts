/// <reference types="bun-types" />
import { formatWorkspaceInstructions } from '@sb/convex/model/session/workspace'
import { describe, expect, test } from 'bun:test'

describe('workspace instruction prompt injection', () => {
  test('formats AGENTS.md as workspace system instructions', () => {
    expect(
      formatWorkspaceInstructions({
        path: 'AGENTS.md',
        content: 'Use bun.\n',
      }),
    ).toBe(`<file path="AGENTS.md">
Use bun.

</file>`)
  })
})
