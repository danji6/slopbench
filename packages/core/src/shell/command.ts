/** Prefix that turns a user message into a shell command invocation. */
export const SHELL_PREFIX = '$'

// `$` followed by a space and at least one non-space character
const SHELL_COMMAND = /^\$[ \t]+(?=\S)/
const ESCAPED_SHELL_COMMAND = /^\\\$[ \t]+(?=\S)/

/**
 * Where the command sits inside a `$ <command>` message, as `[start, end)`
 * offsets, or `null` when the content is ordinary text.
 */
export function shellCommandRange(content: string): [number, number] | null {
  const match = SHELL_COMMAND.exec(content)
  if (!match) return null

  const start = match[0].length
  const end = start + content.slice(start).trimEnd().length
  return end > start ? [start, end] : null
}

/**
 * The command a `$ <command>` message runs, or `null` when the content is
 * ordinary text.
 */
export function parseShellCommand(content: string): string | null {
  const range = shellCommandRange(content)
  return range && content.slice(range[0], range[1])
}

/** Turns `\$ ` into just `$ `. */
export function unescapeShellPrefix(content: string): string {
  return ESCAPED_SHELL_COMMAND.test(content) ? content.slice(1) : content
}
