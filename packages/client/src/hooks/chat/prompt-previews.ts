import { evaluateInBrowser } from '@/lib/evaluation-worker'
import { hasInterpolation } from '@sb/core/interpreter/parse'
import type { EvalContext } from '@sb/core/interpreter/types'
import { useEffect, useState } from 'react'

/** Keeps asynchronous results tied to the exact prompt/context snapshot. */
export function usePromptPreviews(
  texts: string[],
  context: EvalContext,
): string[] {
  const [completed, setCompleted] = useState<{
    source: string[]
    context: EvalContext
    values: string[]
  }>()

  useEffect(() => {
    if (!texts.some(hasInterpolation)) return
    const controller = new AbortController()
    void evaluateInBrowser(
      { texts, context, kind: 'prompt' },
      controller.signal,
    ).then(
      (result) => {
        if (!controller.signal.aborted)
          setCompleted({ source: texts, context, values: result.texts })
      },
      () => {
        if (!controller.signal.aborted)
          setCompleted({
            source: texts,
            context,
            values: texts.map((text) =>
              hasInterpolation(text)
                ? 'Prompt preview could not be evaluated.'
                : text,
            ),
          })
      },
    )
    return () => controller.abort()
  }, [texts, context])
  if (completed?.source === texts && completed.context === context)
    return completed.values
  return texts.map((text) =>
    hasInterpolation(text) ? 'Evaluating prompt…' : text,
  )
}
