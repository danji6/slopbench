import {
  MAX_INTEGRATION_MANIFEST_BYTES,
  validateIntegrationManifest,
} from '@sb/core/types/integration'
import type { IntegrationSnapshot } from '@sb/core/types/integration'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import { assertPlainPath } from '../agent-files/storage'
import { expandHome } from '../mcp/workspace/paths'

/** Reads the exact root manifest without running toolkit code or walking directories. */
export async function inspectIntegration(
  source: string,
): Promise<IntegrationSnapshot> {
  const root = await realpath(path.resolve(expandHome(source)))

  await assertPlainPath(path.resolve(expandHome(source)))
  if (!(await stat(root)).isDirectory())
    throw new Error('Toolkit root must be a directory')

  const file = path.join(root, '.agents', 'integration.json')
  await assertPlainPath(file)
  const handle = await open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  let raw: string

  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_INTEGRATION_MANIFEST_BYTES) {
      throw new Error(
        'Integration manifest must be a regular file of at most 128 KiB',
      )
    }

    const bytes = Buffer.alloc(MAX_INTEGRATION_MANIFEST_BYTES + 1)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    if (bytesRead > MAX_INTEGRATION_MANIFEST_BYTES)
      throw new Error('Integration manifest exceeds 128 KiB')

    raw = bytes.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }

  const manifest = validateIntegrationManifest(JSON.parse(raw))
  manifest.name ??= path.basename(root)

  return {
    root,
    manifest,
    diagnostics: [],
    // Include path semantics so snapshots cannot retain differently resolved launches
    revision: createHash('sha256')
      .update('toolkit-root\0')
      .update(raw)
      .digest('hex'),
  }
}

/** Resolves explicit relative paths and the default cwd from the toolkit root. */
export function integrationConnections(snapshot: IntegrationSnapshot) {
  const root = snapshot.root
  return Object.entries(snapshot.manifest.mcpServers ?? {}).map(
    ([name, server]) => {
      const command =
        server.command?.includes('/') && !path.isAbsolute(server.command)
          ? path.resolve(root, server.command)
          : server.command
      const cwd = resolveIntegrationCwd(root, server.cwd)
      return {
        name,
        command,
        cwd,
        args: server.args,
        url: server.url ?? '',
        transport:
          server.transport ??
          (server.command ? ('stdio' as const) : ('auto' as const)),
        startupTimeoutMs: server.startupTimeoutMs,
        requestTimeoutMs: server.requestTimeoutMs,
        maxTotalTimeoutMs: server.maxTotalTimeoutMs,
      }
    },
  )
}

export async function assertIntegrationRevision(binding?: {
  root: string
  revision: string
}) {
  if (!binding) return
  const current = await inspectIntegration(binding.root)
  if (current.revision !== binding.revision)
    throw new Error(
      'Integration manifest changed; refresh it in Integrations settings',
    )
}

/** Keeps relative templates anchored to the toolkit root until workspace substitution. */
function resolveIntegrationCwd(root: string, cwd?: string) {
  if (!cwd) return root
  if (!cwd.includes('${workspace}')) return path.resolve(root, cwd)
  if (path.isAbsolute(cwd) || cwd.startsWith('${workspace}')) return cwd
  return `${root}${path.sep}${cwd}`
}
