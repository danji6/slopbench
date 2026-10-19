/** Hashes text using Web Crypto in both Convex and Node runtimes. */
export async function sha256(text: string) {
  const encoded = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}
