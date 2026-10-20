/** Real commands whose ordinary workspace paths incorrectly required approval. */
export const REPORTED_APPROVAL_COMMANDS = [
  {
    command: 'ls -la && echo "---README---" && head -50 README.md 2>/dev/null',
    candidates: ['README.md'],
  },
  {
    command:
      'grep -rl -i "mcp" --include="*.ts" --include="*.js" --include="*.md" --include="*.json" . 2>/dev/null | grep -v node_modules | grep -v dist | head -40',
    candidates: ['.'],
  },
  {
    command:
      'ls -la src/server/ src/main/ src/composition/ && echo "===MAIN===" && cat src/main.ts | head -80',
    candidates: ['src/server/', 'src/main/', 'src/composition/', 'src/main.ts'],
  },
  {
    command: String.raw`grep -rn "toolName\|inputSchema\|outputSchema\|McpServer\|registerTools\|register(" src/server/createServer.ts | head -60`,
    candidates: ['src/server/createServer.ts'],
  },
]
