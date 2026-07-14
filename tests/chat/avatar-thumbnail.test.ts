import { afterEach, describe, expect, test } from 'bun:test'
import sharp from 'sharp'
import { pngImage, thumbnailImage } from '@sb/sidecar/io/image'

const originalFetch = globalThis.fetch
const pngBytes = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
  0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120,
  156, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0,
  0, 73, 69, 78, 68, 174, 66, 96, 130,
])

describe('avatar thumbnailing', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('creates a webp thumbnail from an image URL', async () => {
    globalThis.fetch = (async () =>
      new Response(pngBytes, { status: 200 })) as unknown as typeof fetch

    const result = await thumbnailImage({
      imageUrl: 'https://example.com/avatar.png',
      size: 32,
    })
    const bytes = Buffer.from(result.data, 'base64')

    expect(result.contentType).toBe('image/webp')
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP')
  })

  test('converts avatar images to png', async () => {
    const jpegBytes = await sharp(pngBytes).jpeg().toBuffer()

    globalThis.fetch = (async () =>
      new Response(new Uint8Array(jpegBytes), {
        status: 200,
      })) as unknown as typeof fetch

    const result = await pngImage({
      imageUrl: 'https://example.com/avatar.jpg',
    })
    const bytes = Buffer.from(result.data, 'base64')

    expect(result.contentType).toBe('image/png')
    expect(Array.from(bytes.subarray(0, 8))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ])
  })
})
