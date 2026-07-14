export function parseTitle(content: string): string | null {
  return content.match(/# (.+)/)?.[1] || null
}

export function visitAttachments(
  content: string,
  replacer: (alt: string, name: string) => Promise<string | undefined>,
): Promise<string>

export function visitAttachments(
  content: string,
  replacer: (alt: string, name: string) => string | undefined,
): string

export function visitAttachments(
  content: string,
  replacer: (
    alt: string,
    name: string,
  ) => string | undefined | Promise<string | undefined>,
): string | Promise<string> {
  const parts = content.split(/(!\[.*?\]\(.*?\))/g)

  const results = parts.map((v) => {
    const match = v.match(/(!\[(.*?)\])\(<?(.*?)>?\)/)
    if (match?.[3]) {
      const alt = match[2]
      const name = match[3].replace(/^\.?\//, '')
      const replacement = replacer(alt, name)

      if (replacement instanceof Promise) {
        return replacement.then((r) => (r ? `${match[1]}(${r})` : v))
      }

      if (!replacement) {
        return v
      }
      return `${match[1]}(${replacement})`
    }
    return v
  })

  if (results.some((r) => r instanceof Promise)) {
    return Promise.all(results).then((resolved) => resolved.join(''))
  }

  return results.join('')
}

/**
 * Rewrites LaTeX-style math delimiters to the dollar forms our pipeline
 * understands:
 * - `\[ … \]` → `$$ … $$` (display)
 * - `\( … \)` → `$ … $` (inline)
 */
export function normalizeMathDelimiters(source: string): string {
  return source.replace(
    /(```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`]*?`+)|\\\[([\s\S]+?)\\\]|\\\((.+?)\\\)/g,
    (match, code, display, inline) => {
      if (code != null) return match
      if (display != null) return `$$${display}$$`
      return `$${inline}$`
    },
  )
}

/**
 * Reverses the HTML encoding the TipTap markdown serializer applies to text
 * nodes inside math spans.
 */
export function restoreMathEntities(markdown: string): string {
  return markdown.replace(
    /(```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`]*?`+)|(\$\$(?:(?!\$\$)[\s\S])+\$\$|\$[^$\n]+\$)/g,
    (match, code, math) => {
      if (code != null) return match
      return math
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
    },
  )
}

export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#+.*$/gm, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/[*_~]{1,3}(.*?)[*_~]{1,3}/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/^\s*>+/gm, '')
    .replace(/^[*-]{3,}$/gm, '')
    .replace(/[\\\n]/g, ' ')
    .replace(/\s+/g, ' ')
}

export function autoCloseMarkdown(
  text: string,
  precedingText?: string,
): string {
  let result = text

  const inCodeBlockFromPreceding =
    precedingText != null && isInCodeBlock(precedingText)

  if (inCodeBlockFromPreceding || isInCodeBlock(result)) {
    if (!result.endsWith('\n')) {
      result += '\n'
    }
    result += '```'
    return result
  }

  const boldMatches = result.match(/\*\*/g)
  if (boldMatches && boldMatches.length % 2 !== 0) {
    // Trim to avoid flickering rendering when a whitespace is added
    const trimmed = result.trimEnd()
    const trailing = result.slice(trimmed.length)
    result = trimmed + '**' + trailing
  }

  const textWithoutBlocks = result.replace(/```[\s\S]*?```/g, '')
  const tickMatches = textWithoutBlocks.match(/`/g)
  if (tickMatches && tickMatches.length % 2 !== 0) {
    result += '`'
  }

  const straightQuoteMatches = textWithoutBlocks.match(/”/g)
  if (straightQuoteMatches && straightQuoteMatches.length % 2 !== 0) {
    result += '”'
  }

  const openCurly = (textWithoutBlocks.match(/”/g) ?? []).length
  const closeCurly = (textWithoutBlocks.match(/”/g) ?? []).length
  if (openCurly > closeCurly) {
    result += '”'
  }

  return result
}

export function isInCodeBlock(text: string): boolean {
  const matches = text.match(/```/g)
  return matches ? matches.length % 2 !== 0 : false
}

export function splitAtLastBlock(
  text: string,
): [preceding: string, tail: string] {
  let searchFrom = text.length
  while (searchFrom > 0) {
    const pos = text.lastIndexOf('\n\n', searchFrom - 1)
    if (pos === -1) break
    if (!isInCodeBlock(text.slice(0, pos))) {
      return [text.slice(0, pos + 2), text.slice(pos + 2)]
    }
    searchFrom = pos
  }
  return ['', text]
}
