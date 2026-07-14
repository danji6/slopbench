/// <reference types="bun-types" />
import { decodeBase64 } from '@/lib/chat/io'
import { exportAgent, importAgentImage } from '@sb/sidecar/io/agent'
import { afterEach, describe, expect, test } from 'bun:test'
import extractChunks from 'png-chunks-extract'
import sharp from 'sharp'

const originalFetch = globalThis.fetch

const pngBytes = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
  0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120,
  156, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0,
  0, 73, 69, 78, 68, 174, 66, 96, 130,
])

const agentData = {
  name: 'Assistant',
  prompts: [],
  temperature: 1,
  trimContext: false,
  contextWindow: -1,
  outputTokens: -1,
}

describe('agent export I/O', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('sidecar returns JSON export data when no avatar URL is provided', async () => {
    const result = await exportAgent({ data: agentData })

    expect(result.type).toBe('json')
    expect(JSON.parse(result.data)).toEqual(agentData)
  })

  test('decodes base64 payloads without Node Buffer', () => {
    expect(Array.from(decodeBase64('AQIDBA=='))).toEqual([1, 2, 3, 4])
  })

  test('round-trips non-latin agent data in PNG iTXt metadata', async () => {
    const data = {
      version: 1,
      exportedAt: 123,
      agent: {
        ...agentData,
        prompts: [{ content: 'こんにちは Привет مرحبا 🌍' }],
      },
    }
    const jpegBytes = await sharp(pngBytes).jpeg().toBuffer()
    let exportedPng = new Uint8Array()
    let uploadedPng = new Uint8Array()

    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input)

      if (url === 'https://example.com/avatar.png') {
        return new Response(new Uint8Array(jpegBytes), { status: 200 })
      }

      if (url === 'https://example.com/exported.png') {
        return new Response(exportedPng, { status: 200 })
      }

      if (url === 'https://example.com/upload') {
        uploadedPng = new Uint8Array(
          await new Response(init?.body).arrayBuffer(),
        )
        return Response.json({ storageId: 'avatar-storage-id' })
      }

      return new Response(null, { status: 404 })
    }) as typeof fetch

    const result = await exportAgent({
      avatarUrl: 'https://example.com/avatar.png',
      data,
    })
    expect(result.type).toBe('png')

    exportedPng = Buffer.from(result.data, 'base64')
    expect(
      extractChunks(exportedPng).some((chunk) => chunk.name === 'iTXt'),
    ).toBe(true)

    const imported = await importAgentImage({
      fileUrl: 'https://example.com/exported.png',
      uploadUrl: 'https://example.com/upload',
    })

    expect(imported).toEqual({
      data,
      avatarStorageId: 'avatar-storage-id',
    })
    expect(
      extractChunks(uploadedPng).some((chunk) => chunk.name === 'iTXt'),
    ).toBe(false)
  })
})
