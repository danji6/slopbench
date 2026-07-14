import katex from 'katex'

const cache = new Map<string, string>()
const MAX_ENTRIES = 1000

export function renderMathHtml(latex: string, display: boolean): string {
  // Normalize so the viewer and editor use the same cache key despite
  // whitespace differences
  const normalized = latex.trim()
  const key = (display ? 'd:' : 'i:') + normalized
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  let html: string
  try {
    html = katex.renderToString(normalized, {
      displayMode: display,
      throwOnError: false,
    })
  } catch {
    html = escapeHtml(normalized)
  }

  if (cache.size >= MAX_ENTRIES) {
    cache.delete(cache.keys().next().value!)
  }
  cache.set(key, html)
  return html
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
