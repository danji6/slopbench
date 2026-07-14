import {
  getCachedHighlight,
  highlight,
  highlightDiff,
} from '@/lib/shiki/highlighter'
import { useEffect, useState } from 'react'

/**
 * Uses Shiki to highlight code.
 * @param diff - Treat code as a unified diff
 */
export function useCode(
  text?: string,
  language: string = 'typescript',
  diff: boolean = false,
) {
  const [code, setCode] = useState<string | null>(() =>
    text ? getCachedHighlight(text, language, diff) : null,
  )

  useEffect(() => {
    if (!text) return

    let mounted = true
    const source = text

    async function loadCode() {
      const highlighted = diff
        ? await highlightDiff(source, language)
        : await highlight(source, language)
      if (!mounted) return

      setCode(highlighted)
    }

    loadCode()

    return () => {
      mounted = false
    }
  }, [text, language, diff])

  return code
}
