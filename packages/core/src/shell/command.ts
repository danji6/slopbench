/** Prefix that turns a user message into a shell command invocation. */
export const SHELL_PREFIX = '$'

// `$` followed by a space and at least one non-space character
const SHELL_COMMAND = /^\$[ \t]+(?=\S)/
const ESCAPED_SHELL_COMMAND = /^\\\$[ \t]+(?=\S)/

/**
 * The command a `$ <command>` message runs, or `null` when the content is
 * ordinary text.
 */
export function parseShellCommand(content: string): string | null {
  const match = SHELL_COMMAND.exec(content)
  if (!match) return null

  const command = content.slice(match[0].length).trimEnd()
  return command || null
}

/** Turns `\$ ` into just `$ `. */
export function unescapeShellPrefix(content: string): string {
  return ESCAPED_SHELL_COMMAND.test(content) ? content.slice(1) : content
}
