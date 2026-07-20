/// <reference types="bun-types" />
import {
  getToolErrorText,
  getToolStatus,
  groupKey,
  groupParts,
  isToolInFlight,
} from '@/lib/chat'
import { parseToolOutput } from '@/lib/chat/tool-output'
import type { ToolUIPart, UIMessage } from 'ai'
import { describe, expect, test } from 'bun:test'

function toolPart(part: Partial<ToolUIPart>): ToolUIPart {
  return {
    type: 'tool-test',
    toolCallId: 'call-1',
    state: 'output-available',
    ...part,
  } as ToolUIPart
}

function readPart(id: string): UIMessage['parts'][number] {
  return toolPart({
    type: 'tool-read_file',
    toolCallId: id,
  } as Partial<ToolUIPart>) as UIMessage['parts'][number]
}

const textPart = { type: 'text', text: 'hi' } as UIMessage['parts'][number]
const stepPart = { type: 'step-start' } as UIMessage['parts'][number]

describe('tool part status', () => {
  test('treats an output-error part as an error', () => {
    const part = toolPart({
      state: 'output-error',
      errorText: 'edits[0].oldText is not unique',
    } as Partial<ToolUIPart>)

    expect(getToolStatus(part)).toBe('error')
    expect(getToolErrorText(part)).toBe('edits[0].oldText is not unique')
  })

  test('does not treat a "Tool failed:" string output as an error', () => {
    const part = toolPart({ output: 'Tool failed: legacy string' })

    expect(getToolStatus(part)).toBe('complete')
    expect(getToolErrorText(part)).toBeUndefined()
  })

  test('collapses a Zod validation payload to its message for display', () => {
    const issues = [
      {
        code: 'invalid_type',
        path: ['path'],
        message: 'path is required: a workspace-relative file path.',
      },
    ]
    const part = toolPart({
      state: 'output-error',
      errorText: `Invalid input for tool edit_file: ${JSON.stringify(issues)}`,
    } as Partial<ToolUIPart>)

    expect(getToolErrorText(part)).toBe(
      'path is required: a workspace-relative file path.',
    )
  })

  test('keeps normal output as complete', () => {
    const part = toolPart({ output: 'command completed' })

    expect(getToolStatus(part)).toBe('complete')
    expect(getToolErrorText(part)).toBeUndefined()
  })

  test('treats preliminary output as running', () => {
    const part = toolPart({
      output: 'partial',
      preliminary: true,
    } as Partial<ToolUIPart>)

    expect(getToolStatus(part)).toBe('running')
  })

  test('detects in-flight tool states', () => {
    expect(isToolInFlight(toolPart({ state: 'input-streaming' }))).toBe(true)
    expect(isToolInFlight(toolPart({ state: 'input-available' }))).toBe(true)
    expect(isToolInFlight(toolPart({ state: 'approval-responded' }))).toBe(true)
    expect(
      isToolInFlight(
        toolPart({
          state: 'output-available',
          preliminary: true,
        } as Partial<ToolUIPart>),
      ),
    ).toBe(true)
    expect(isToolInFlight(toolPart({ state: 'approval-requested' }))).toBe(
      false,
    )
    expect(isToolInFlight(toolPart({ state: 'output-available' }))).toBe(false)
    expect(isToolInFlight(toolPart({ state: 'output-error' }))).toBe(false)
  })
})

describe('tool part grouping', () => {
  test('groups consecutive read_file parts', () => {
    const groups = groupParts([readPart('a'), readPart('b'), textPart])

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ type: 'tools', toolName: 'read_file' })
    if (groups[0].type !== 'tools') throw new Error('expected tools group')
    expect(groups[0].parts).toHaveLength(2)
    expect(groups[1]).toMatchObject({ type: 'single' })
  })

  test('groups read_file parts across step boundaries', () => {
    const groups = groupParts([readPart('a'), stepPart, readPart('b')])

    expect(groups).toHaveLength(1)
    if (groups[0].type !== 'tools') throw new Error('expected tools group')
    expect(groups[0].parts.map((p) => p.toolCallId)).toEqual(['a', 'b'])
  })

  test('wraps a single read_file into a tools group', () => {
    const groups = groupParts([readPart('a')])

    expect(groups[0].type).toBe('tools')
  })

  test('does not group across other parts', () => {
    const groups = groupParts([readPart('a'), textPart, readPart('b')])

    expect(groups).toHaveLength(3)
  })
})

describe('group keys', () => {
  test('are collision-free across mixed groups', () => {
    const groups = groupParts([
      textPart,
      readPart('a'),
      readPart('b'),
      stepPart,
      toolPart({ type: 'tool-shell', toolCallId: 'shell-1' }),
      textPart,
    ])

    const keys = groups.map(groupKey)
    expect(new Set(keys).size).toBe(groups.length)
  })

  test('tool groups key on toolCallId, not index', () => {
    const before = groupParts([textPart, readPart('a'), readPart('b')])
    const after = groupParts([textPart, textPart, readPart('a'), readPart('b')])

    const beforeTools = before.find((g) => g.type === 'tools')
    const afterTools = after.find((g) => g.type === 'tools')
    if (!beforeTools || !afterTools) throw new Error('expected tools groups')

    // The grouped read_file block keeps its key even though it shifted index.
    expect(groupKey(beforeTools)).toBe(groupKey(afterTools))
  })

  test('existing keys stay stable when a part is appended', () => {
    const parts: UIMessage['parts'] = [
      textPart,
      toolPart({ type: 'tool-shell', toolCallId: 'shell-1' }),
    ]
    const before = groupParts(parts).map(groupKey)

    const grown = groupParts([
      ...parts,
      toolPart({ type: 'tool-shell', toolCallId: 'shell-2' }),
    ]).map(groupKey)

    expect(grown.slice(0, before.length)).toEqual(before)
  })
})

describe('tool output parsing', () => {
  test('parses JSON string outputs', () => {
    const part = toolPart({
      output: JSON.stringify({ path: 'src/a.ts', truncated: false }),
    })

    expect(parseToolOutput<{ path: string }>(part)?.path).toBe('src/a.ts')
  })

  test('passes through object outputs', () => {
    const part = toolPart({ output: { jobId: 'j1' } })

    expect(parseToolOutput<{ jobId: string }>(part)?.jobId).toBe('j1')
  })

  test('returns undefined for failure text', () => {
    const part = toolPart({ output: 'Tool failed: nope' })

    expect(parseToolOutput(part)).toBeUndefined()
  })
})
