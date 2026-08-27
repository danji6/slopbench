const REASONING_TAG = 'reasoning'

/** Maps a provider-specific reasoning field into tagged OpenAI content. */
export async function adaptReasoningResponse(
  response: Response,
  field: string,
  stream?: boolean,
): Promise<Response> {
  if (!response.ok || !response.body) return response

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (stream || contentType.includes('text/event-stream')) {
    return cloneResponse(response, adaptEventStream(response.body, field))
  }
  if (contentType.includes('application/json')) {
    return adaptJsonResponse(response, field)
  }
  return response
}

function adaptEventStream(
  body: ReadableStream<Uint8Array>,
  field: string,
): ReadableStream<Uint8Array> {
  const activeChoices = new Set<number>()
  let buffered = ''
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffered += decoder.decode(chunk, { stream: true })
        const lines = buffered.split('\n')
        buffered = lines.pop() ?? ''
        for (const line of lines) {
          controller.enqueue(encoder.encode(`${adaptEventLine(line)}\n`))
        }
      },
      flush(controller) {
        buffered += decoder.decode()
        if (buffered)
          controller.enqueue(encoder.encode(adaptEventLine(buffered)))
      },
    }),
  )

  function adaptEventLine(line: string): string {
    const match = /^(data:\s*)(.*)$/.exec(line)
    if (!match || match[2] === '[DONE]') return line

    try {
      const event = JSON.parse(match[2]) as Record<string, unknown>
      adaptChoices(event.choices, field, activeChoices)
      return `${match[1]}${JSON.stringify(event)}`
    } catch {
      return line
    }
  }
}

async function adaptJsonResponse(
  response: Response,
  field: string,
): Promise<Response> {
  const text = await response.text()
  try {
    const data = JSON.parse(text) as Record<string, unknown>
    adaptChoices(data.choices, field)
    return cloneResponse(response, JSON.stringify(data))
  } catch {
    return cloneResponse(response, text)
  }
}

function adaptChoices(
  value: unknown,
  field: string,
  activeChoices?: Set<number>,
) {
  if (!Array.isArray(value)) return

  for (const [position, rawChoice] of value.entries()) {
    if (!isRecord(rawChoice)) continue

    const choiceIndex =
      typeof rawChoice.index === 'number' ? rawChoice.index : position
    const part = isRecord(rawChoice.delta)
      ? rawChoice.delta
      : isRecord(rawChoice.message)
        ? rawChoice.message
        : undefined
    if (!part) continue

    const reasoning = part[field]
    const content = typeof part.content === 'string' ? part.content : ''
    const isActive = activeChoices?.has(choiceIndex) ?? false
    const isFinished = rawChoice.finish_reason != null

    if (typeof reasoning === 'string' && reasoning.length > 0) {
      const open = isActive ? '' : `<${REASONING_TAG}>`
      const close =
        !activeChoices || content || isFinished ? `</${REASONING_TAG}>` : ''
      part.content = `${open}${reasoning}${close}${content}`
      if (close) activeChoices?.delete(choiceIndex)
      else activeChoices?.add(choiceIndex)
    } else if (isActive && (content || isFinished)) {
      part.content = `</${REASONING_TAG}>${content}`
      activeChoices?.delete(choiceIndex)
    }
    delete part[field]
  }
}

function cloneResponse(response: Response, body: BodyInit): Response {
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  headers.delete('content-encoding')
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
