export function startTitleProvider(onRequest?: () => Promise<void>) {
  const requests: { messages: { role: string; content: string }[] }[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      requests.push(await request.json())
      await onRequest?.()
      return Response.json({
        id: 'title-response',
        object: 'chat.completion',
        created: 0,
        model: 'title-model',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Un fine settimana romano' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })
    },
  })
  return { server, requests }
}
