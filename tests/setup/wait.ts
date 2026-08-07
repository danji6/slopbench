/** Resolves once `predicate` holds, polling until it does. */
export async function waitFor(
  what: string,
  predicate: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`)
    }
    await new Promise((r) => setTimeout(r, 10))
  }
}
