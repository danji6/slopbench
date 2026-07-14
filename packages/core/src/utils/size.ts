/** Cheap serialized-size approximation in UTF-16 code units. */
export function serializedSize(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0
}
