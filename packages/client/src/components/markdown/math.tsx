import { renderMathHtml } from '@/lib/katex/render'

/** Whether a `code` element's className marks it as math */
export function matchMathClass(className?: string): boolean | null {
  if (!className) return null
  if (/\bmath-display\b/.test(className)) return true
  if (/\bmath-inline\b/.test(className)) return false
  return null
}

/** Renders LaTeX via the shared KaTeX cache. */
export function KatexMath({
  latex,
  display,
}: {
  latex: string
  display: boolean
}) {
  return (
    <span
      className={display ? 'katex-display-wrap' : 'katex-inline-wrap'}
      dangerouslySetInnerHTML={{ __html: renderMathHtml(latex, display) }}
    />
  )
}
