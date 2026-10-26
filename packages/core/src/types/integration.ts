import { z } from 'zod'

import { SKILL_NAME_SOURCE } from '../skills/names'
import { mcpConnectionSchema } from './mcp'
import type { McpServer } from './mcp'

export const MAX_INTEGRATIONS = 32
export const MAX_INTEGRATION_MANIFEST_BYTES = 128 * 1024

const INTEGRATION_SKILL_URI = new RegExp(
  `^integration://([^/]+)/skills/(${SKILL_NAME_SOURCE})/(.+)$`,
)

type WorkspaceSettings = Pick<McpServer, 'cwd' | 'args' | 'env'>

const serverSchema = z.looseObject({
  transport: z.enum(['stdio', 'auto', 'http', 'sse', 'ws']).optional(),
  command: z.string().max(4096).optional(),
  args: z.array(z.string().max(8192)).max(256).optional(),
  cwd: z.string().max(4096).optional(),
  url: z.string().max(8192).optional(),
  startupTimeoutMs: z.number().int().min(100).max(300_000).optional(),
  requestTimeoutMs: z.number().int().min(100).max(86_400_000).optional(),
  maxTotalTimeoutMs: z.number().int().min(100).max(86_400_000).optional(),
})

export const integrationManifestSchema = z.looseObject({
  schemaVersion: z.literal(1).default(1),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().optional(),
  version: z.string().max(120).optional(),
  mcpServers: z
    .record(z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), serverSchema)
    .refine(
      (servers) => Object.keys(servers).length <= 32,
      'At most 32 MCP servers are supported',
    )
    .optional(),
})

export type IntegrationManifest = z.infer<typeof integrationManifestSchema>

export type IntegrationSnapshot = {
  root: string
  revision: string
  manifest: IntegrationManifest
  diagnostics: string[]
}

/** Parses a skill resource URI without resolving or reading its contents. */
export function parseIntegrationSkillUri(value: string) {
  const match = INTEGRATION_SKILL_URI.exec(value)
  if (!match) return undefined
  return { integrationId: match[1], name: match[2], resource: match[3] }
}

/** Rejects unknown launch settings while allowing descriptive extension fields. */
export function validateIntegrationManifest(
  value: unknown,
): IntegrationManifest {
  const manifest = integrationManifestSchema.parse(value)

  const allowed = new Set([
    ...Object.keys(serverSchema.shape),
    'description',
    'title',
    'documentationUrl',
    '_meta',
  ])

  for (const [name, server] of Object.entries(manifest.mcpServers ?? {})) {
    const unsupported = Object.keys(server).filter(
      (key) => !allowed.has(key) && !key.startsWith('x-'),
    )
    if (unsupported.length) {
      throw new Error(
        `${name}: unsupported connection settings: ${unsupported.join(', ')}`,
      )
    }

    const ambiguous = !!server.command === !!server.url
    if (ambiguous)
      throw new Error(`${name}: specify exactly one of command or url`)
    if (!server.command && (server.args || server.cwd))
      throw new Error(`${name}: args and cwd require stdio`)
    if (server.command?.includes('${workspace}'))
      throw new Error(`${name}: workspace is not supported in command`)
    const transport = server.transport ?? (server.command ? 'stdio' : 'auto')
    if ((transport === 'stdio') !== !!server.command)
      throw new Error(`${name}: transport does not match command or URL`)

    mcpConnectionSchema.parse({ ...server, transport })
  }

  return manifest
}

/** Substitutes only the explicit workspace token; never interprets shell syntax. */
export function integrationWorkspaceSettings<T extends WorkspaceSettings>(
  settings: T,
  workspace?: string,
): T {
  const replace = (value: string) => {
    if (!value.includes('${workspace}')) return value
    if (!workspace) throw new Error('This integration requires a workspace')
    return value.replaceAll('${workspace}', workspace)
  }
  return {
    ...settings,
    cwd: settings.cwd === undefined ? undefined : replace(settings.cwd),
    args: settings.args?.map(replace),
    env:
      settings.env &&
      Object.fromEntries(
        Object.entries(settings.env).map(([name, value]) => [
          name,
          replace(value),
        ]),
      ),
  }
}
