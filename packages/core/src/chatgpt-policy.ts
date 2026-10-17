/** Applies the subscription contract after all ordinary SDK options have been serialized. */
export function prepareChatGPTRequest(body: Record<string, unknown>) {
  const result = { ...body, store: false, stream: true } as Record<string, unknown> // prettier-ignore
  if (!Array.isArray(result.input))
    throw new Error('ChatGPT requests must include full history')

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

  const serializedInput = JSON.stringify(result.input)
  if (
    /"(?:type|media_type)":"(?:input_audio|input_video|audio\/[^" ]+|video\/[^" ]+)"/.test(
      serializedInput,
    )
  ) {
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
