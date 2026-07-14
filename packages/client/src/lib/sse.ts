export type SseFrame = { event: string; data: string }

export async function* readSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseFrame> {
  const reader = body.getReader()
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

export function parseSseFrame(raw: string): SseFrame | null {
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
