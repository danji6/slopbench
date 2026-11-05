/** Serializes JSON with sorted object keys while preserving array order. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) => {
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
      return nested
    }

    return Object.fromEntries(
      Object.entries(nested).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    )
  })
}
