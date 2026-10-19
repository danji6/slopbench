const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

const NAME = '[A-Za-z_][\\w.:-]*'
const OPEN_TAG = new RegExp(
  `^<(${NAME})((?:\\s+[^\\s"'<>/=\\x60]+(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'=<>\\x60]+))?)*)\\s*(/?)>$`,
)
const CLOSE_TAG = new RegExp(`^<\\/(${NAME})\\s*>`)

type XmlTag = {
  name: string
  end: number
  closing: boolean
  empty: boolean
}

/** Recognizes HTML elements that never need a closing tag. */
export function isHtmlVoidTag(name: string): boolean {
  return VOID_TAGS.has(name.toLowerCase())
}

/** Returns the newly completed opener's name unless its closer already exists. */
export function xmlTagToClose(before: string, after: string): string | null {
  const tags = scanTags(before)
  const opener = openingTagAtEnd(tags, before.length)
  if (!opener) return null

  // Reserve existing closers for enclosing tags with the same name first
  let pending = 0
  for (const tag of tags) {
    if (tag.name !== opener.name || tag.empty) continue
    pending = tag.closing ? Math.max(0, pending - 1) : pending + 1
  }
  for (const tag of scanTags(after)) {
    if (tag.name !== opener.name || tag.empty) continue
    pending += tag.closing ? -1 : 1
    if (pending === 0) return null
  }
  return opener.name
}

/** Recognizes adjacent opening and closing tags around an empty caret. */
export function isEmptyXmlTagPair(before: string, after: string): boolean {
  const opener = openingTagAtEnd(scanTags(before), before.length)
  if (!opener) return false
  return CLOSE_TAG.exec(after)?.[1] === opener.name
}

function openingTagAtEnd(tags: XmlTag[], end: number): XmlTag | null {
  const tag = tags.at(-1)
  if (!tag || tag.end !== end) return null
  if (tag.closing || tag.empty) return null
  return tag
}

/** Scans markup without treating quoted attributes or comments as nested tags. */
function scanTags(text: string): XmlTag[] {
  const tags: XmlTag[] = []
  let at = 0
  while (at < text.length) {
    const start = text.indexOf('<', at)
    if (start === -1) break
    const ignoredEnd = ignoredMarkupEnd(text, start)
    if (ignoredEnd !== null) {
      at = ignoredEnd
      continue
    }
    if (!/^<\/?[A-Za-z_]/.test(text.slice(start, start + 3))) {
      at = start + 1
      continue
    }
    const end = markupEnd(text, start)
    if (end === text.length && text[end - 1] !== '>') break
    const tag = parseTag(text.slice(start, end), end)
    if (tag) tags.push(tag)
    at = end
  }
  return tags
}

function parseTag(text: string, end: number): XmlTag | null {
  const close = CLOSE_TAG.exec(text)
  if (close?.[0].length === text.length) {
    return { name: close[1], end, closing: true, empty: false }
  }
  const open = OPEN_TAG.exec(text)
  if (!open) return null
  const name = open[1]
  return {
    name,
    end,
    closing: false,
    empty: text.endsWith('/>') || isHtmlVoidTag(name),
  }
}

/** Skips comments, CDATA, processing instructions, and declarations. */
function ignoredMarkupEnd(text: string, start: number): number | null {
  for (const [prefix, closer] of [
    ['<!--', '-->'],
    ['<![CDATA[', ']]>'],
    ['<?', '?>'],
  ]) {
    if (!text.startsWith(prefix, start)) continue
    const end = text.indexOf(closer, start + prefix.length)
    return end === -1 ? text.length : end + closer.length
  }
  return text.startsWith('<!', start) ? markupEnd(text, start) : null
}

/** Finds the end of markup, respecting quotes and declaration subsets. */
function markupEnd(text: string, start: number): number {
  let quote = ''
  let subset = 0
  const declaration = text.startsWith('<!', start)
  for (let at = start + 1; at < text.length; at++) {
    const char = text[at]
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (declaration && char === '[') subset++
    else if (declaration && char === ']') subset--
    else if (char === '>' && subset === 0) return at + 1
  }
  return text.length
}
