import { APP_NAME } from '../const'

export const INTEGRATION_GUIDE = `
An integration is a way to bring a toolkit’s MCP tools and skills into ${APP_NAME}.
Link its directory, then select it in your agent’s Integration settings.

### How to integrate a toolkit

Create \`.agents/integration.json\` in the toolkit's root directory, then add
a name and the command that starts its MCP server.

This example shows all supported configuration fields and optional server metadata:

\`\`\`json
{
  "name": "WebTools",
  "description": "Fetch and analyze web pages with local and remote tools.",
  "version": "1.0.0",
  "mcpServers": {
    "fetch-page": {
      "transport": "stdio",
      "command": "node",
      "args": ["scripts/fetch.mjs", "mcp"],
      "cwd": ".",
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

\`name\` defaults to the toolkit directory’s name. \`description\` and \`version\`
are optional. The description appears in the agent's integration list; refresh
the manifest in settings to apply edits.
The \`mcpServers\` section is also optional, while skills are automatically
read from the \`.agents/skills\` directory.

### Connections

Each server needs either \`command\` for a local process or \`url\` for a remote
server. Without \`transport\`, a command selects \`stdio\` and a URL selects
\`auto\`. Remote transports are \`auto\` (tries HTTP, then SSE), \`http\`,
\`sse\`, or \`ws\`. Use HTTP(S) URLs for the first three, and WS(S) URLs for
WebSocket.

\`args\` and \`cwd\` are optional and only apply to local processes. Relative
executable paths containing a slash and relative \`cwd\` values resolve from
the toolkit root containing \`.agents\`. Without \`cwd\`, the process starts in that
same root. Plain commands such as \`node\` use the host’s PATH.

Use \`\${workspace}\` in \`args\` or \`cwd\` to refer to the session’s primary
workspace directory. For example, \`"cwd": "\${workspace}"\` starts the server
in that directory, while \`"args": ["--target", "\${workspace}"]\` passes its
path to the server. Such integrations require a session with a workspace.

### Timeouts

Timeouts are optional integer values in milliseconds (the example shows the
defaults when omitted):
- \`startupTimeoutMs\` limits connection startup
- \`requestTimeoutMs\` limits inactivity between updates
- \`maxTotalTimeoutMs\` limits the total operation duration

The minimum value is 100ms. Startup allows up to 300000ms, and the other two
allow up to 86400000ms.

### Metadata

\`title\`, \`description\`, \`documentationUrl\`, \`_meta\`, and fields starting with
\`x-\` are optional descriptive metadata. Additional descriptive fields are also
allowed at the manifest’s top level.
`.trim()
