import encodeChunks from 'png-chunks-encode'
import extractChunks from 'png-chunks-extract'
import sharp from 'sharp'
import { z } from 'zod'

const CHUNK_KEYWORD = 'agent'

// Validation happens in Convex
export const agentPayloadSchema = z.record(z.string(), z.unknown())

export const exportAgentSchema = z.object({
  avatarUrl: z.string().url().optional(),
  data: agentPayloadSchema,
})

export const importAgentSchema = z.object({
  fileUrl: z.string().url(),
  uploadUrl: z.string().url(),
})

export type AgentArchivePayload = z.infer<typeof agentPayloadSchema>

export type AgentExportResult = {
  type: 'png' | 'json'
  data: string
}

export async function exportAgent({
  avatarUrl,
  data,
}: z.infer<typeof exportAgentSchema>): Promise<AgentExportResult> {
  if (!avatarUrl) {
    return {
      type: 'json',
      data: JSON.stringify(data, null, 2),
    }
  }

  const buffer = await fetchAvatarPng(avatarUrl)
  const chunks = extractChunks(buffer)
  const filtered = chunks.filter((chunk) => !isAgentChunk(chunk))
  filtered.splice(-1, 0, encodeAgentChunk(JSON.stringify(data)))

  return {
    type: 'png',
    data: Buffer.from(encodeChunks(filtered)).toString('base64'),
  }
}

export async function importAgentImage({
  fileUrl,
  uploadUrl,
}: z.infer<typeof importAgentSchema>): Promise<{
  data: AgentArchivePayload
  avatarStorageId: string
}> {
  const buffer = await fetchPng(fileUrl)
  const chunks = extractChunks(buffer)
  const agentChunk = chunks.find(isAgentChunk)
  if (!agentChunk) throw new Error('No agent data found in image')

  const data = agentPayloadSchema.parse(
    JSON.parse(decodeAgentChunk(agentChunk)),
  )
  const cleanChunks = chunks.filter((chunk) => !isAgentChunk(chunk))
  const cleanBuffer = Buffer.from(encodeChunks(cleanChunks))

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    body: cleanBuffer,
    headers: { 'Content-Type': 'image/png' },
  })
  if (!uploadResponse.ok) {
    throw new Error(`Avatar upload failed: ${uploadResponse.status}`)
  }

  const uploadResult = (await uploadResponse.json()) as { storageId?: string }
  if (!uploadResult.storageId)
    throw new Error('Avatar upload did not return storageId')

  return { data, avatarStorageId: uploadResult.storageId }
}

async function fetchPng(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`PNG fetch failed: ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function fetchAvatarPng(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Avatar fetch failed: ${response.status}`)

  const input = Buffer.from(await response.arrayBuffer())
  return sharp(input).rotate().png().toBuffer()
}

function encodeAgentChunk(text: string): { name: 'iTXt'; data: Uint8Array } {
  return {
    name: 'iTXt',
    data: Buffer.concat([
      Buffer.from(CHUNK_KEYWORD, 'latin1'),
      Buffer.from([0, 0, 0, 0, 0]),
      Buffer.from(text, 'utf8'),
    ]),
  }
}

function decodeAgentChunk(chunk: { name: string; data: Uint8Array }): string {
  if (chunk.name !== 'iTXt') throw new Error('Invalid agent data chunk')

  const data = Buffer.from(chunk.data)
  const keywordEnd = data.indexOf(0)
  if (keywordEnd < 0) throw new Error('Invalid agent data chunk')

  const textStart = findTextStart(data, keywordEnd + 1)
  return data.subarray(textStart).toString('utf8')
}

function isAgentChunk(chunk: { name: string; data: Uint8Array }): boolean {
  return chunk.name === 'iTXt' && readKeyword(chunk.data) === CHUNK_KEYWORD
}

function readKeyword(data: Uint8Array): string | undefined {
  const buffer = Buffer.from(data)
  const end = buffer.indexOf(0)
  return end < 0 ? undefined : buffer.subarray(0, end).toString('latin1')
}

function findTextStart(data: Buffer, start: number): number {
  let offset = start + 2
  offset = data.indexOf(0, offset) + 1
  if (offset === 0) throw new Error('Invalid agent data chunk')

  offset = data.indexOf(0, offset) + 1
  if (offset === 0) throw new Error('Invalid agent data chunk')

  return offset
}
