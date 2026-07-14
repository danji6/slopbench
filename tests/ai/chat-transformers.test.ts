/// <reference types="bun-types" />
import {
  formatStreamWarnings,
  normalizeUnsupportedWarnings,
  omitLargeStrings,
} from '@sb/convex/model/stream/transformers'
import { describe, expect, test } from 'bun:test'

async function collectStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader()
  const chunks: T[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) return chunks
    chunks.push(value)
  }
}

describe('chat stream transformers', () => {
  test('normalizes unsupported warnings on raw stream starts', async () => {
    const input = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'stream-start',
          warnings: [
            {
              type: 'unsupported',
              feature: 'presencePenalty',
              details: 'Ignored by this provider.',
            },
            { type: 'other', message: 'kept as-is' },
          ],
        })
        controller.close()
      },
    })

    const output = await collectStream(
      input.pipeThrough(normalizeUnsupportedWarnings({ tools: {} }) as never),
    )

    expect(output).toEqual([
      {
        type: 'stream-start',
        warnings: [
          {
            type: 'unsupported-setting',
            setting: 'presencePenalty',
            details: 'Ignored by this provider.',
          },
          { type: 'other', message: 'kept as-is' },
        ],
      },
    ])
  })

  test('normalizes unsupported warnings on generated step starts', async () => {
    const input = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'start-step',
          request: {},
          warnings: [
            { type: 'unsupported', feature: 'frequencyPenalty' },
            { type: 'compatibility', feature: 'presencePenalty' },
          ],
        })
        controller.close()
      },
    })

    const output = await collectStream(
      input.pipeThrough(normalizeUnsupportedWarnings({ tools: {} }) as never),
    )

    expect(output).toEqual([
      {
        type: 'start-step',
        request: {},
        warnings: [
          { type: 'unsupported-setting', setting: 'frequencyPenalty' },
          { type: 'unsupported-setting', setting: 'presencePenalty' },
        ],
      },
    ])
  })

  test('formats and deduplicates warnings for message metadata', () => {
    expect(
      formatStreamWarnings([
        {
          type: 'unsupported-setting',
          setting: 'presencePenalty',
          details: 'Ignored by this provider.',
        },
        {
          type: 'unsupported-setting',
          setting: 'presencePenalty',
          details: 'Ignored by this provider.',
        },
        { type: 'other', message: 'kept as-is' },
        { type: 'unknown', ignored: true },
      ]),
    ).toEqual([
      'The provider does not support "presencePenalty". Ignored by this provider.',
      'kept as-is',
    ])
  })
})

describe('omitLargeStrings', () => {
  test('omits binary/base64 strings and keeps siblings intact', () => {
    const data = 'A'.repeat(15000)
    const result = omitLargeStrings({
      messages: [
        {
          role: 'user',
          parts: [
            { type: 'text', text: 'hello' },
            { type: 'file', mediaType: 'image/png', data },
          ],
        },
      ],
    }) as {
      messages: {
        parts: {
          type: string
          text?: string
          mediaType?: string
          data?: string
        }[]
      }[]
    }

    const parts = result.messages[0].parts
    expect(parts[0]).toEqual({ type: 'text', text: 'hello' })
    expect(parts[1]).toEqual({
      type: 'file',
      mediaType: 'image/png',
      data: `[omitted binary data ${data.length} chars]`,
    })
  })

  test('preserves long plain text while redacting embedded base64 payloads', () => {
    const plainText = 'not binary '.repeat(3000)
    const base64 = 'QUJD'.repeat(300)
    const result = omitLargeStrings({
      plainText,
      mixed: `before ${base64} after`,
      dataUrl: `data:image/png;base64,${base64}`,
    }) as {
      plainText: string
      mixed: string
      dataUrl: string
    }

    expect(result.plainText).toBe(plainText)
    expect(result.mixed).toBe(
      `before [omitted binary data ${base64.length} chars] after`,
    )
    expect(result.dataUrl).toBe(
      `data:image/png;base64,[omitted binary data ${base64.length} chars]`,
    )
  })

  test('preserves structure and stays JSON-serializable', () => {
    const input = {
      type: 'stream',
      provider: 'anthropic',
      settings: { temperature: 0.7, topP: null, tools: ['a', 'b'] },
    }
    const result = omitLargeStrings(input)
    expect(result).toEqual(input)
    expect(() => JSON.stringify(result)).not.toThrow()
  })
})
