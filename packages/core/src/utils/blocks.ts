export type BlockAttrs = Record<string, string>

/** Collapse control whitespace and escape characters that break an attribute. */
export function escapeAttr(value: string): string {
  return value
    .trim()
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Opening tag of a context block, with escaped attributes. */
export function openBlock(tag: string, attrs: BlockAttrs = {}): string {
  const rendered = Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escapeAttr(value)}"`)
    .join('')
  return `<${tag}${rendered}>`
}

export function closeBlock(tag: string): string {
  return `</${tag}>`
}

/** Wrap content in a `<tag>\n{content}\n</tag>` block. */
export function block(
  tag: string,
  content: string,
  attrs: BlockAttrs = {},
): string {
  return `${openBlock(tag, attrs)}\n${content}\n${closeBlock(tag)}`
}

export function systemReminder(...lines: string[]): string {
  return block('system-reminder', lines.join('\n'))
}
