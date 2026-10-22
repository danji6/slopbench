import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { McpProtocolRequest } from '@sb/core/types/mcp-protocol'
import { MAX_MCP_RESULT_BYTES } from '@sb/core/types/mcp-result'

/** Uses only implemented client capabilities; no sampling or elicitation is advertised. */
export async function requestProtocol(
  client: Client,
  input: McpProtocolRequest,
  options: RequestOptions = {},
) {
  if (input.method === 'get_server_info') {
    return {
      initialization: JSON.parse(initializationContext(client)) as Record<
        string,
        unknown
      >,
    }
  }
  const capabilities = client.getServerCapabilities()
  const prompt = input.method === 'list_prompts' || input.method === 'get_prompt' // prettier-ignore
  if (prompt ? !capabilities?.prompts : !capabilities?.resources) {
    throw new Error(
      `This MCP server does not support ${prompt ? 'prompts' : 'resources'}`,
    )
  }

  switch (input.method) {
    case 'get_prompt':
      return client.getPrompt(
        { name: input.name!, arguments: input.arguments },
        options,
      )
    case 'read_resource':
      return client.readResource({ uri: input.uri! }, options)
    case 'list_prompts':
      return collectProtocolPages('prompts', (cursor) =>
        client.listPrompts({ cursor }, options),
      )
    case 'list_resources':
      return collectProtocolPages('resources', (cursor) =>
        client.listResources({ cursor }, options),
      )
    case 'list_resource_templates':
      return collectProtocolPages('resourceTemplates', (cursor) =>
        client.listResourceTemplates({ cursor }, options),
      )
  }
}

type Page = { nextCursor?: string; [key: string]: unknown }

/** Collects every page before publication, rejecting loops and explicit capacity limits. */
async function collectProtocolPages(
  key: string,
  fetchPage: (cursor?: string) => Promise<Page>,
) {
  const rows: unknown[] = []
  const pages: Record<string, unknown>[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  let bytes = 0

  for (let count = 0; count < 1000; count++) {
    const page = await fetchPage(cursor)
    const items = page[key]
    if (!Array.isArray(items))
      throw new Error('Malformed MCP protocol inventory')

    rows.push(...items)
    const { [key]: _items, nextCursor: _next, ...metadata } = page
    pages.push(metadata)
    bytes += Buffer.byteLength(JSON.stringify(page))

    if (rows.length > 5000 || bytes > MAX_MCP_RESULT_BYTES) {
      throw new Error(
        'MCP protocol inventory capacity exceeded; discovery is incomplete',
      )
    }

    cursor = page.nextCursor
    if (cursor === undefined) {
      return { [key]: rows, pageMetadata: pages }
    }
    if (!cursor || cursors.has(cursor)) {
      throw new Error(
        'MCP protocol inventory returned an invalid or repeated cursor',
      )
    }

    cursors.add(cursor)
  }
  throw new Error(
    'MCP protocol page capacity exceeded; discovery is incomplete',
  )
}

/** Captures initialization guidance as literal data with bounded storage. */
export function initializationContext(client: Client) {
  const context = {
    instructions: client.getInstructions(),
    implementation: client.getServerVersion(),
    capabilities: client.getServerCapabilities(),
    untrusted: true as const,
  }
  const text = JSON.stringify(context)
  if (Buffer.byteLength(text) > 128 * 1024)
    throw new Error(
      'MCP initialization context exceeds the 128 KiB capacity; guidance was not truncated',
    )
  return text
}
