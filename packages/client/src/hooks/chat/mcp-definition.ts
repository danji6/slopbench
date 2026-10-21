import { loadMcpDefinition } from '@/lib/chat/mcp-definition'
import { useEffect, useState } from 'react'

type Request = {
  url: string
  name: string
  attempt: number
}

type Result = Request & {
  description?: string
  error?: string
}

/** Keeps a full description tied to its current authorized URL and tool. */
export function useMcpDefinition(url: string | null | undefined, name: string) {
  const [completed, setCompleted] = useState<Result>()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!url) return
    return requestDefinition({ url, name, attempt }, setCompleted)
  }, [url, name, attempt])

  const sameDefinition = completed?.url === url && completed?.name === name
  const result =
    sameDefinition && completed?.attempt === attempt ? completed : undefined
  const error =
    url === null
      ? 'Tool definition is unavailable. Refresh the catalog and reopen this tool.'
      : result?.error
  return {
    description: result?.description,
    loading: url !== null && !result,
    error,
    retry: () => setAttempt((previous) => previous + 1),
  }
}

/** Cancels detached loads and leaves network failures available for retry. */
function requestDefinition(
  request: Request,
  complete: (result: Result) => void,
) {
  const controller = new AbortController()
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(30_000),
  ])
  function finish(result: Pick<Result, 'description' | 'error'>) {
    if (!controller.signal.aborted) complete({ ...request, ...result })
  }
  void loadMcpDefinition(request.url, request.name, signal).then(
    (definition) => finish({ description: definition.description ?? '' }),
    () => finish({ error: 'Could not load the full tool description.' }),
  )
  return () => controller.abort()
}
