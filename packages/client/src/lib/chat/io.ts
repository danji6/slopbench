import { normalizeBrowserUrl } from '@/lib/auth/site-url'
import type { SessionArchive } from '@/lib/chat'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { FileUIPart } from 'ai'

import { ImageTool } from '../io'
import { fileToDataUrl } from '../utils'

type ExportResult = { type: 'png' | 'json'; data: string; name: string }

// TODO make this configurable in an "Advanced" settings tab in ChatSettings
const MAX_IMAGE_DIMENSION = 640

export type ProcessedFile = {
  part: FileUIPart
  originalFile?: File
}

export async function processFileForUpload(file: File): Promise<ProcessedFile> {
  let url: string

  if (file.type.startsWith('image/')) {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(
      MAX_IMAGE_DIMENSION / bitmap.width,
      MAX_IMAGE_DIMENSION / bitmap.height,
      1,
    )
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    url = await new ImageTool(file)
      .resize({ width, height })
      .compress(0.8)
      .format('image/jpeg')
      .toBase64()

    return {
      originalFile: file,
      part: {
        type: 'file',
        url,
        mediaType: file.type,
        filename: file.name,
      },
    }
  }

  url = await fileToDataUrl(file)
  return {
    part: {
      type: 'file',
      url,
      mediaType: file.type,
      filename: file.name,
    },
  }
}

export function triggerAgentDownload(result: ExportResult) {
  const { type, data, name } = result
  const blob =
    type === 'png'
      ? new Blob([decodeBase64(data)], { type: 'image/png' })
      : new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = type === 'png' ? `${name}.png` : `${name}.json`
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function triggerJsonDownload(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeFileBaseName(name)}.json`
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function readSessionArchive(file: File): Promise<SessionArchive> {
  return JSON.parse(await file.text()) as SessionArchive
}

export function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = globalThis.atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}

export async function uploadAgentFile(
  file: File,
  generateUploadUrl: () => Promise<string>,
): Promise<
  | { type: 'png'; storageId: Id<'_storage'> }
  | { type: 'json'; data: Record<string, unknown> }
> {
  if (file.type === 'image/png' || file.name.endsWith('.png')) {
    const uploadUrl = normalizeBrowserUrl(await generateUploadUrl())
    if (!uploadUrl) throw new Error('Upload URL not available')
    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'image/png' },
    })
    const { storageId } = (await response.json()) as {
      storageId: Id<'_storage'>
    }
    return { type: 'png', storageId }
  }

  const data = JSON.parse(await file.text()) as Record<string, unknown>
  return { type: 'json', data }
}

function safeFileBaseName(value: string) {
  const withoutControls = Array.from(value.trim(), (char) =>
    char < ' ' ? '-' : char,
  ).join('')
  const name = withoutControls
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim()

  return name || 'session'
}
