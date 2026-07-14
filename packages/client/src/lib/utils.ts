import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

import { PayloadTooLargeError } from './errors'

export const safeWindow = getWindow()
export const safeDocument = getDocument()
export const isClient = !!safeWindow
export const isServer = !isClient
export const isLocal = import.meta.env.DEV

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export async function sleep(ms: number): Promise<void> {
  return await new Promise((resolve) => setTimeout(resolve, ms))
}

export function shuffle<T>(array: readonly T[]): T[] {
  const result = [...array]

  for (let index = result.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[randomIndex]] = [result[randomIndex], result[index]]
  }

  return result
}

export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  wait: number,
): ((...args: TArgs) => void) & { cancel: () => void } {
  let timeout: ReturnType<typeof setTimeout> | undefined

  function debounced(...args: TArgs) {
    if (timeout) {
      clearTimeout(timeout)
    }

    timeout = setTimeout(() => {
      timeout = undefined
      fn(...args)
    }, wait)
  }

  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout)
      timeout = undefined
    }
  }

  return debounced
}

export function nonNullable<T>(t: T, msg?: string): NonNullable<T> {
  if (t === null) {
    throw new Error(`Value was null${msg ? ` (${msg})` : ''}`)
  }

  if (t === undefined) {
    throw new Error(`Value was undefined${msg ? ` (${msg})` : ''}`)
  }

  return t as NonNullable<T>
}

export async function imageLoad(image: HTMLImageElement) {
  return new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = (error) => reject(error)
  })
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export async function fileToDataUrl(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
  return `data:${file.type || 'application/octet-stream'};base64,${base64}`
}

export function dataUrlToFile(dataUrl: string, filename = 'file'): File {
  const [header, base64] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)?.[1] ?? 'application/octet-stream'
  const binary = atob(base64)
  const array = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i)
  }
  return new File([array], filename, { type: mime })
}

export function scrollToId(id: string, smooth = false) {
  if (!safeDocument) return false
  const element = safeDocument.getElementById(id)
  if (!element) return false

  setTimeout(() => {
    element.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' })
    if (safeWindow) {
      safeWindow.history.pushState(null, '', `#${id}`)
    }
  }, 0)

  return true
}

export async function dynamicImport<T>(url: string): Promise<T> {
  return (await new Function('url', 'return import(url)')(url)).default as T
}

export function downloadJson(obj: unknown, filename: string) {
  download(
    new Blob([JSON.stringify(obj)], { type: 'application/json' }),
    filename,
  )
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  a.remove()
}

export function formatDuration(ms: number): string {
  const seconds = ms / 1000
  return seconds === 0
    ? '0s'
    : seconds < 1
      ? `${seconds.toFixed(2)}s`
      : `${seconds.toFixed(1)}s`
}

export function formatLongDuration(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`)

  return parts.join('')
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

export function formatRelativeTime(
  timestamp: number,
  now = Date.now(),
): string {
  const diff = now - timestamp

  if (diff < MINUTE) return 'now'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d`

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

export function abbreviateNumber(value: number): string {
  if (value === 0) return '0'
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  }
  return value.toString()
}

export function expandNumber(value: string | number): number {
  if (typeof value === 'number') return value

  const str = value.trim().toLowerCase()
  const match = str.match(/^(-?\d+(?:\.\d+)?)\s*([a-z]+)?$/)
  if (!match) throw new Error(`Invalid number format: ${value}`)

  const num = parseFloat(match[1])
  const suffix = match[2] ?? ''

  const units: Record<string, number> = {
    '': 1,
    b: 1,
    k: 1_000,
    kb: 1_024,
    m: 1_000_000,
    mb: 1_048_576,
    g: 1_000_000_000,
    gb: 1_073_741_824,
  }

  const multiplier = units[suffix]
  if (multiplier === undefined) throw new Error(`Unknown suffix: ${value}`)

  return num * multiplier
}

export function collapsePath(input: string): string {
  const isWindows = input.includes('\\') || /^[A-Za-z]:/.test(input)
  const sep = isWindows ? '\\' : '/'
  const segments = input.split(sep)

  if (segments.length - 1 <= 5) return input

  return [segments[0], '...', ...segments.slice(-2)].join(sep)
}

export async function readRequestBody(
  body: ReadableStream<Uint8Array> | null,
  maxSize: number,
): Promise<string> {
  if (!body) throw new Error('Request body is required')

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  const chunks: Uint8Array[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    size += value.byteLength
    if (size > maxSize) {
      reader.cancel()
      throw new PayloadTooLargeError(maxSize)
    }

    chunks.push(value)
  }

  const totalLength = chunks.reduce((acc, c) => acc + c.byteLength, 0)
  const combined = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return decoder.decode(combined)
}

export function generateId(): string {
  if (typeof crypto !== 'undefined') {
    if (crypto.randomUUID) {
      return crypto.randomUUID()
    }

    if (crypto.getRandomValues) {
      return (
        ([1e7] as unknown as string) +
        -1e3 +
        -4e3 +
        -8e3 +
        -1e11
      ).replace(/[018]/g, (c) =>
        (
          (c as unknown as number) ^
          (crypto.getRandomValues(new Uint8Array(1))[0] &
            (15 >> ((c as unknown as number) / 4)))
        ).toString(16),
      )
    }
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function withDefaults<T extends Record<string, unknown>>(
  partial: Partial<T>,
  defaults: T,
): T {
  const result = { ...defaults }
  for (const key in partial) {
    if (partial[key] !== undefined) {
      result[key] = partial[key] as T[Extract<keyof T, string>]
    }
  }
  return result
}

export function keyFor(val: unknown): string {
  return typeof val === 'string'
    ? val
    : typeof val === 'object'
      ? JSON.stringify(val)
      : String(val)
}

export function isVideo(src: unknown): boolean {
  if (!src || typeof src !== 'string') return false
  try {
    const type = new URL(src).searchParams.get('type')
    if (type?.startsWith('video/')) return true
    if (src.match(/\.(mp4|webm)$/i)) return true
  } catch {
    // no op
  }
  return false
}

export function isTouchDevice() {
  return (
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  )
}

function getWindow() {
  return typeof globalThis !== 'undefined' && 'window' in globalThis
    ? (globalThis as unknown as Window & typeof globalThis)
    : undefined
}

function getDocument() {
  return getWindow()?.document
}
