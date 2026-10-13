/** Generates a UUID with fallbacks for browsers without randomUUID. */
export function generateId(): string {
  if (typeof crypto !== 'undefined') {
    if (crypto.randomUUID) {
      return crypto.randomUUID()
    }

    if (crypto.getRandomValues) {
      return (
        ([1e7] as unknown as string) +
        -1e3 +
        -4e3 +
        -8e3 +
        -1e11
      ).replace(/[018]/g, (c) =>
        (
          (c as unknown as number) ^
          (crypto.getRandomValues(new Uint8Array(1))[0] &
            (15 >> ((c as unknown as number) / 4)))
        ).toString(16),
      )
    }
  }

  return generateFallbackId()
}

/** Generates a UUID when Web Crypto is unavailable. */
function generateFallbackId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
