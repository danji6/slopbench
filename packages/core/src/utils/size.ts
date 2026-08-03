export function serializedSize(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0
}

/**
 * Groups parts into segments, the same way long streaming turns are split.
 * Callers are responsible for rejecting parts that exceed the budget.
 *
 * Always returns at least one chunk.
 */
export function splitParts(parts: unknown[], budget: number): unknown[][] {
  const chunks: unknown[][] = [[]]
  let size = 0

  for (const part of parts) {
    const partSize = serializedSize(part)
    const current = chunks[chunks.length - 1]

    if (current.length > 0 && size + partSize > budget) {
      chunks.push([part])
      size = partSize
      continue
    }

    current.push(part)
    size += partSize
  }

  return chunks
}
