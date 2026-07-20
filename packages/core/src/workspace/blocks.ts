import { block } from '../utils/blocks'

/** Normalize a path for a block attribute (escaping happens at render). */
export function blockPath(path: string): string {
  return path.trim() || 'file'
}

/** Wrap file content in a `<file path="...">` block. */
export function fileBlock(path: string, content: string): string {
  return block('file', content, { path: blockPath(path) })
}
