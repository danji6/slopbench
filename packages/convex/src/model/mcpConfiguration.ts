import type { McpServer } from '@sb/core/types'

import type { AuthMutationCtx } from '../functions'
import * as Credentials from './credentials'

type LaunchSettings = Pick<
  McpServer,
  | 'integrationBinding'
  | 'url'
  | 'transport'
  | 'command'
  | 'args'
  | 'cwd'
  | 'env'
  | 'startupTimeoutMs'
  | 'requestTimeoutMs'
  | 'maxTotalTimeoutMs'
>

/** Selects launch settings without credentials or presentation metadata. */
export function launchFields(server: LaunchSettings) {
  return {
    integrationBinding: server.integrationBinding,
    url: server.url,
    command: server.command,
    args: server.args,
    cwd: server.cwd,
    env: server.env,
    startupTimeoutMs: server.startupTimeoutMs,
    requestTimeoutMs: server.requestTimeoutMs,
    maxTotalTimeoutMs: server.maxTotalTimeoutMs,
  }
}

export function parseSecrets(raw?: string): Record<string, string> {
  return raw ? (JSON.parse(raw) as Record<string, string>) : {}
}

export async function saveCredentials(
  ctx: AuthMutationCtx,
  key: string,
  apiKey: string | undefined,
  secretEnv: Record<string, string> | undefined,
) {
  if (apiKey !== undefined) {
    await Credentials.set(ctx, ctx.userId, 'mcp', key, apiKey)
  }
  if (secretEnv !== undefined) {
    const previous = parseSecrets(
      await Credentials.get(ctx, ctx.userId, 'mcp-env', key),
    )
    for (const [name, value] of Object.entries(secretEnv)) {
      if (value) previous[name] = value
      else delete previous[name]
    }
    await Credentials.set(
      ctx,
      ctx.userId,
      'mcp-env',
      key,
      Object.keys(previous).length ? JSON.stringify(previous) : '',
    )
  }
}
