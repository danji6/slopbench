/// <reference types="bun-types" />
import {
  OFFLOAD_THRESHOLD,
  collectToolOutputStorageIds,
  hasOutputRef,
  isOffloadableToolPart,
  makeOutputPreview,
  serializeToolOutput,
} from '@sb/convex/model/stream/toolOutput'
import { describe, expect, test } from 'bun:test'

const bigText = 'x'.repeat(OFFLOAD_THRESHOLD + 1)

function shellOutput(text: string, term: string) {
  return {
    jobId: 'job1',
    status: 'done',
    exitCode: 0,
    text,
    term,
    termOffset: 200_000,
  }
}

describe('isOffloadableToolPart', () => {
  test('text parts are never offloadable', () => {
    expect(isOffloadableToolPart({ type: 'text', text: bigText })).toBe(false)
  })

  test('finalized tool output with a call id is offloadable', () => {
    expect(
      isOffloadableToolPart({
        type: 'tool-shell',
        state: 'output-available',
        toolCallId: 'c1',
        output: shellOutput(bigText, bigText),
      }),
    ).toBe(true)
  })

  test('preliminary (still-running) outputs are skipped', () => {
    expect(
      isOffloadableToolPart({
        type: 'tool-shell',
        state: 'output-available',
        toolCallId: 'c1',
        preliminary: true,
        output: shellOutput('', bigText),
      }),
    ).toBe(false)
  })

  test('already-offloaded parts are skipped', () => {
    expect(
      isOffloadableToolPart({
        type: 'tool-shell',
        state: 'output-available',
        toolCallId: 'c1',
        output: shellOutput(bigText, bigText),
        outputRef: 'storage123',
      }),
    ).toBe(false)
  })

  test('input-streaming tool parts are skipped', () => {
    expect(
      isOffloadableToolPart({
        type: 'tool-shell',
        state: 'input-streaming',
        toolCallId: 'c1',
        output: undefined,
      }),
    ).toBe(false)
  })
})

describe('makeOutputPreview', () => {
  test('truncates term tail and keeps termOffset consistent with the kept tail', () => {
    const term = 'a'.repeat(200_000)
    const output = shellOutput(bigText, term)
    const preview = makeOutputPreview(output) as {
      text: string
      term: string
      termOffset: number
      truncated: boolean
    }

    expect(preview.truncated).toBe(true)
    expect(preview.term.length).toBeLessThan(term.length)
    expect(preview.text.length).toBeLessThan(bigText.length)
    // termOffset + kept term length must still point at the original end
    expect(preview.termOffset + preview.term.length).toBe(
      output.termOffset + term.length,
    )
  })

  test('truncates plain string outputs', () => {
    const preview = makeOutputPreview(bigText) as string
    expect(typeof preview).toBe('string')
    expect(preview.length).toBeLessThan(bigText.length)
  })

  test('truncates arbitrary large string fields (e.g. read_file content)', () => {
    const preview = makeOutputPreview({
      path: 'src/a.ts',
      content: bigText,
    }) as { path: string; content: string; truncated: boolean }

    expect(preview.path).toBe('src/a.ts')
    expect(preview.content.length).toBeLessThan(bigText.length)
    expect(preview.truncated).toBe(true)
  })
})

describe('collectToolOutputStorageIds / hasOutputRef', () => {
  test('collects only parts carrying an outputRef', () => {
    const parts = [
      { type: 'text', text: 'hi' },
      { type: 'tool-shell', state: 'output-available', outputRef: 's1' },
      { type: 'tool-read_file', state: 'output-available' },
      { type: 'tool-web_fetch', state: 'output-available', outputRef: 's2' },
    ]

    expect(hasOutputRef(parts[1])).toBe(true)
    expect(hasOutputRef(parts[2])).toBe(false)
    expect(collectToolOutputStorageIds(parts)).toEqual(['s1', 's2'] as never)
  })
})

describe('serializeToolOutput round-trip', () => {
  test('object outputs survive serialize -> parse verbatim', () => {
    const output = shellOutput('hello', 'world')
    expect(JSON.parse(serializeToolOutput(output))).toEqual(output)
  })

  test('string outputs survive serialize -> parse verbatim', () => {
    expect(JSON.parse(serializeToolOutput('plain text'))).toBe('plain text')
  })
})
