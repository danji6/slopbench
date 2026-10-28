type KeyedRow = { key: string }

/** Detects prefix edits whose retained rows all move by the list length difference. */
export function shiftsOnlyAtStart(
  previous: readonly KeyedRow[],
  next: readonly KeyedRow[],
) {
  const shift = next.length - previous.length
  if (!shift || !previous.length || !next.length) return false
  if (previous.at(-1)!.key !== next.at(-1)!.key) return false
  const indices = new Map(next.map((row, index) => [row.key, index]))
  return previous.every((row, index) => {
    const target = indices.get(row.key)
    return target === undefined || target === index + shift
  })
}
