/** Encodes a connection and a provider model ID as one opaque selection value. */
export function modelReference(connectionId: string, modelId: string): string {
  return `sb-model:${encodeURIComponent(connectionId)}:${encodeURIComponent(modelId)}`
}

/** Decodes current selections while preserving legacy and manually entered IDs. */
export function parseModelReference(value: string) {
  const match = /^sb-model:([^:]+):(.+)$/.exec(value)
  if (!match) return { modelId: value, connectionId: undefined }
  try {
    return {
      connectionId: decodeURIComponent(match[1]),
      modelId: decodeURIComponent(match[2]),
    }
  } catch {
    return { modelId: value, connectionId: undefined }
  }
}
