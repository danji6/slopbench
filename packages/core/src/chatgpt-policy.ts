const HTTP_HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]+$/

/** Applies the subscription contract after all ordinary SDK options have been serialized. */
export function prepareChatGPTRequest(body: Record<string, unknown>) {
  const result = { ...body, store: false, stream: true } as Record<string, unknown> // prettier-ignore
  if (!Array.isArray(result.input))
    throw new Error('ChatGPT requests must include full history')

  chatGPTCacheKey(result)

  result.input = result.input
    .map((item) => {
      if (!item || typeof item !== 'object') return item
      if (item.role === 'system') return { ...item, role: 'developer' }
      if (item.type === 'item_reference')
        throw new Error('ChatGPT history cannot use stored response references')
      if (item.type === 'reasoning' && !item.encrypted_content) return undefined
      return item
    })
    .filter(Boolean)

  const audioOrVideoPattern =
    /"(?:type|media_type)":"(?:input_audio|input_video|audio\/[^" ]+|video\/[^" ]+)"/ // prettier-ignore
  const hasAudioOrVideo = audioOrVideoPattern.test(JSON.stringify(result.input))
  if (hasAudioOrVideo) {
    throw new Error(
      'ChatGPT plan access does not support audio or video inputs',
    )
  }

  if (Array.isArray(result.tools)) {
    for (const tool of result.tools) {
      if (tool.type !== 'namespace' && tool.type !== 'web_search')
        throw new Error('ChatGPT plan access requires namespaced client tools')
    }
  }

  return result
}

/** Reads a cache identity that can be sent unchanged as an HTTP header. */
export function chatGPTCacheKey(body: Record<string, unknown>) {
  const key = body.prompt_cache_key
  if (key === undefined) return undefined

  const message =
    'ChatGPT prompt_cache_key must be a nonempty HTTP header value'
  const keyFitsHeader =
    typeof key === 'string' && !!key.trim() && HTTP_HEADER_VALUE.test(key)
  if (!keyFitsHeader) throw new Error(message)

  try {
    const headers = new Headers({ 'session-id': key })
    if (headers.get('session-id') === key) return key
  } catch {
    // Reject characters that HTTP headers cannot carry.
  }

  throw new Error(message)
}
