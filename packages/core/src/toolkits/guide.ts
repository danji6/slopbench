import { APP_NAME } from '../const'

export const TOOLKIT_GUIDE = `
A toolkit provides MCP tools and skills from a local directory to ${APP_NAME}
in a self-contained manner.

### How to link a toolkit

Create \`.agents/toolkit.json\` in the toolkit's root directory, then add
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

All top-level fields are optional:
- \`name\` defaults to the toolkit directory’s name
- \`description\` tells the agent what the toolkit is for
- \`mcpServers\` describes the available MCP servers (more info below)

Skills are automatically read from the \`.agents/skills\` directory.

### MCP servers

Each server needs either \`command\` for a local process or \`url\` for a remote
server. Without \`transport\`, a command defaults to \`stdio\`. Remote transports
are \`auto\` (tries HTTP, then SSE), \`http\`, \`sse\`, or \`ws\`.

\`args\` and \`cwd\` are optional and only apply to local processes. Relative
executable paths containing a slash and relative \`cwd\` values resolve from
the toolkit root (parent folder of \`.agents\`). Without \`cwd\`, the process
starts in that same root. Plain commands such as \`node\` use the host’s PATH.

Use \`\${workspace}\` in \`args\` or \`cwd\` to refer to the session’s primary
workspace directory. For example, \`"cwd": "\${workspace}"\` starts the server
in that directory, while \`"args": ["--target", "\${workspace}"]\` passes its
path to the server. Such toolkits require a session with a workspace set.

#### Timeouts

Timeouts are optional integer values in milliseconds (the example shows the
defaults when omitted):
- \`startupTimeoutMs\` limits connection startup
- \`requestTimeoutMs\` limits inactivity between updates
- \`maxTotalTimeoutMs\` limits the total operation duration

The minimum value is 100ms. Startup allows up to 300000ms, and the other two
allow up to 86400000ms.

#### Metadata

\`title\`, \`description\`, \`documentationUrl\`, \`_meta\`, and fields starting
with \`x-\` are optional descriptive metadata. Additional descriptive fields are
also allowed at the manifest’s top level.
`.trim()
