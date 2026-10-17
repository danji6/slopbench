/** Fails truncated and incomplete streams even when text was already received. */
export function requireCompletedStream(
  body: ReadableStream<Uint8Array>,
  release: () => void = () => {},
) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let completed = false

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read()
        if (next.done) {
          release()
          if (!completed) {
            controller.error(
              new Error('ChatGPT stream ended without response.completed'),
            )
            return
          }
          controller.close()
          return
        }

        pending += decoder.decode(next.value, { stream: true })
        let separator: RegExpExecArray | null

        while ((separator = /\r?\n\r?\n/.exec(pending))) {
          const frame = pending.slice(0, separator.index)
          pending = pending.slice(separator.index + separator[0].length)

          const data = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n')
          if (!data || data === '[DONE]') continue

          const event = JSON.parse(data) as {
            type?: string
            response?: { error?: { code?: string; message?: string } }
          }

          const responseFailed =
            event.type === 'response.failed' ||
            event.type === 'response.incomplete' ||
            event.type === 'error'
          if (responseFailed) {
            throw new Error(
              event.response?.error?.code?.startsWith(
                'subscription_sharing_usage_limit',
              )
                ? 'ChatGPT plan usage limit reached. Review usage in ChatGPT settings.'
                : 'ChatGPT could not complete this response. Retry or check provider settings.',
            )
          }
          if (event.type === 'response.completed') completed = true
        }
        if (pending.length > 4_000_000)
          throw new Error('ChatGPT stream event exceeded the size limit')
        controller.enqueue(next.value)
      } catch (err) {
        release()
        await reader.cancel().catch(() => {})
        controller.error(err)
      }
    },
    async cancel(reason) {
      release()
      await reader.cancel(reason)
    },
  })
}
