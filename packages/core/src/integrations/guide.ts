import { APP_NAME } from '../const'

export const INTEGRATION_GUIDE = `
An integration brings a toolkit’s MCP tools and skills into ${APP_NAME}.
Link its directory, then select it in your agent’s Integration settings.

### How to integrate a toolkit

Create \`.agents/integration.json\` in the toolkit's root directory, then add
a name and the command that starts its MCP server.

This example shows all supported configuration fields and optional server metadata:

\`\`\`json
{
  "schemaVersion": 1,
  "name": "WebTools",
  "version": "1.0.0",
  "mcpServers": {
    "fetch-page": {
      "transport": "stdio",
      "command": "node",
      "args": ["scripts/fetch.mjs", "mcp"],
      "cwd": "..",
      "startupTimeoutMs": 30000,
      "requestTimeoutMs": 300000,
      "maxTotalTimeoutMs": 1800000,
      "title": "Fetch page",
      "description": "Fetch web pages as Markdown",
      "documentationUrl": "https://example.com/webtools",
      "_meta": { "category": "web" },
      "x-author": "Example team"
    },
    "remote-tools": {
      "transport": "auto",
      "url": "https://example.com/mcp"
    }
  }
}
\`\`\`

\`schemaVersion\` defaults to 1, the only supported version. \`name\` defaults
to the toolkit directory’s name, and \`version\` is optional. The \`mcpServers\`
section is optional. Skills are automatically read from \`.agents/skills\`;
a \`skills\` entry is not used.

### Server connections

Each server needs either \`command\` for a local process or \`url\` for a remote
server. Specify exactly one. Without \`transport\`, a command selects \`stdio\`
and a URL selects \`auto\`. Remote transports are \`auto\` (tries HTTP, then SSE),
\`http\`, \`sse\`, or \`ws\`. Use HTTP(S) URLs for the first three, and WS(S) URLs
for WebSocket.

\`args\` and \`cwd\` are optional and only apply to local processes. Relative
executable paths containing a slash and relative \`cwd\` values resolve from
\`.agents\`. Without \`cwd\`, the process starts in the toolkit root; the example’s
\`..\` selects that same root. Bare commands such as \`node\` use the sidecar host’s
PATH. Arguments are passed literally without a shell. Use \`\${workspaceRoot}\`
in arguments or \`cwd\` to refer to the chat’s workspace; that integration then
requires a workspace.

### Timeouts and metadata

Timeouts are optional integer values in milliseconds. The local server example
shows the defaults: \`startupTimeoutMs\` limits connection startup,
\`requestTimeoutMs\` limits inactivity between updates, and \`maxTotalTimeoutMs\`
limits the total operation duration. The minimum is 100; startup allows up to
300000, and the other two allow up to 86400000.

\`title\`, \`description\`, \`documentationUrl\`, \`_meta\`, and fields starting with
\`x-\` are optional descriptive metadata. Additional descriptive fields are also
allowed at the manifest’s top level. Metadata does not change how a server starts.
Environment overrides, credentials, and installation hooks are not supported
manifest settings.
`.trim()
