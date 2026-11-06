import { open } from 'node:fs/promises'

/** Persists directory entries on platforms that support directory syncing. */
export async function syncDirectory(directory: string) {
  // Windows cannot flush a read-only directory handle.
  if (process.platform === 'win32') return

  const handle = await open(directory, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
