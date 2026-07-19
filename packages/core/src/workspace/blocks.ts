/** Collapse control whitespace and escape characters that break the path attribute. */
export function escapeBlockPath(path: string): string {
  const normalized = path.trim().replace(/[\r\n\t]+/g, ' ') || 'file'
  return normalized
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Wrap file content in the canonical `<file path="...">` context block. */
export function fileBlock(path: string, content: string): string {
  return `<file path="${escapeBlockPath(path)}">\n${content}\n</file>`
}
