import { open } from 'node:fs/promises'

/** Bounds the working set of edit/diff/checkpoint operations. */
const SNAPSHOT_READ_BYTES = 8 * 1024 * 1024

export async function readEditSnapshot(filename: string): Promise<string> {
  const file = await open(filename, 'r')
  try {
    const info = await file.stat()

    if (!info.isFile()) {
      throw new Error('Path is not a regular file')
    }
    if (info.size > SNAPSHOT_READ_BYTES) {
      throw new Error(
        'File exceeds the edit-preview read budget; use bounded read_file pages or streaming shell tools',
      )
    }

    const buffer = Buffer.alloc(Math.min(info.size, SNAPSHOT_READ_BYTES) + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > info.size || bytesRead > SNAPSHOT_READ_BYTES)
      throw new Error('File grew beyond the edit-preview read budget')

    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await file.close()
  }
}
