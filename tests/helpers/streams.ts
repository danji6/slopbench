/** Collects a finite stream so tests can inspect its output and transform effects. */
export async function collectStream<T>(
  stream: ReadableStream<T>,
): Promise<T[]> {
  const reader = stream.getReader()
  const chunks: T[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return chunks
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
}

/** Creates a finite stream from explicit provider events. */
export function streamOf<T>(chunks: T[]): ReadableStream<T> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}
