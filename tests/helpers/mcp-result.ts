import { mcpResultSchema } from '@sb/core/types/mcp-result'

/** Asserts the versioned envelope before inspecting a fixture's text payload. */
export function mcpText(output: unknown) {
  return mcpResultSchema
    .parse(output)
    .result.content.filter((part) => part.type === 'text')
    .map((part) => String(part.text))
    .join('\n')
}
