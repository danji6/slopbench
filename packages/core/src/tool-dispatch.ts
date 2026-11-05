/** Original provider call retained when dispatch uses a logical target internally. */
export type WireToolCall = {
  name: string
  input: unknown
}

/** Reads dispatcher metadata without changing the logical tool part. */
export function wireToolCall(part: unknown): WireToolCall | undefined {
  const value = (part as { wireCall?: WireToolCall } | null)?.wireCall
  if (!value || typeof value.name !== 'string' || !('input' in value)) return
  return value
}
