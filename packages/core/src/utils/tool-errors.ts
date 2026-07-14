type ZodIssueLike = { message?: unknown }

/** Pulls the human-readable messages out of a Zod issues array (raw or nested). */
function zodIssueMessages(value: unknown): string | null {
  const issues = Array.isArray(value)
    ? value
    : value &&
        typeof value === 'object' &&
        Array.isArray((value as { issues?: unknown }).issues)
      ? (value as { issues: unknown[] }).issues
      : null
  if (!issues) return null

  const messages = issues
    .map((issue) =>
      issue &&
      typeof issue === 'object' &&
      typeof (issue as ZodIssueLike).message === 'string'
        ? ((issue as ZodIssueLike).message as string)
        : null,
    )
    .filter((message): message is string => message !== null)

  return messages.length > 0 ? messages.join('\n') : null
}

/** Collapse a persisted tool `errorText` for display. */
export function collapseToolError(text: string): string {
  const start = text.indexOf('[')
  if (start !== -1) {
    try {
      const collapsed = zodIssueMessages(JSON.parse(text.slice(start)))
      if (collapsed) return collapsed
    } catch {
      // Not a JSON, fall through to the original text
    }
  }
  return text
}
