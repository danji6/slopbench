import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpConnection } from '@sb/core/types'
import { fileURLToPath } from 'node:url'

const RESERVED = new Set(['SIDECAR_SECRET', 'SLOPBENCH_MCP_LAUNCH'])

/** Builds a minimal environment; configured bindings never inherit backend secrets. */
export function localEnvironment(
  connection: McpConnection,
): Record<string, string> {
  const env = {
    ...getDefaultEnvironment(),
    ...connection.env,
    ...connection.secretEnv,
  }
  for (const name of Object.keys(env)) {
    if (RESERVED.has(name.toUpperCase())) delete env[name]
  }
  return env
}

/** Launches a supervisor so EOF also cleans children after a sidecar crash. */
export function localTransport(connection: McpConnection) {
  if (connection.transport !== 'stdio')
    throw new Error('Expected a local MCP command')
  const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js'
  const supervisor = fileURLToPath(
    new URL(`./stdio-supervisor.${extension}`, import.meta.url),
  )
  return new StdioClientTransport({
    command: process.execPath,
    args: process.versions.bun ? ['--no-env-file', supervisor] : [supervisor],
    cwd: connection.cwd,
    env: {
      ...localEnvironment(connection),
      SLOPBENCH_MCP_LAUNCH: JSON.stringify({
        command: connection.command,
        args: connection.args ?? [],
      }),
    },
    stderr: 'pipe',
  })
}
