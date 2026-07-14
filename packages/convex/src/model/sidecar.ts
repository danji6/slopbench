import { error } from '../errors'

export const SIDECAR_URL = process.env.SIDECAR_URL
  ? process.env.SIDECAR_URL
  : 'http://localhost:3212'

export async function postSidecar<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${SIDECAR_URL}${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })

  if (!response.ok) {
    const message = await response.text()
    error(`Local server request failed: ${message}`, 500)
  }

  return (await response.json()) as T
}

export type ShellStreamEvent = { event: string; data: string }

/** Opens an SSE endpoint and yields parsed `{ event, data }` frames. */
export async function* openShellStream(
  path: string,
  query: Record<string, string>,
  signal?: AbortSignal,
): AsyncGenerator<ShellStreamEvent> {
  const url = `${SIDECAR_URL}${path}?${new URLSearchParams(query).toString()}`
  const response = await fetch(url, {
    headers: { Accept: 'text/event-stream' },
    signal,
  })

  if (response.status === 404) error('Job not found for this session', 404)
  if (!response.ok || !response.body) {
    const message = await response.text().catch(() => response.statusText)
    error(`Local server stream failed: ${message}`, 500)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = parseSseFrame(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        if (frame) yield frame
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

function parseSseFrame(raw: string): ShellStreamEvent | null {
  let event = 'message'
  const data: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) continue
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:'))
      data.push(line.slice(5).replace(/^ /, ''))
  }
  return data.length ? { event, data: data.join('\n') } : null
}
