import type { AgentHome } from '@sb/core/skills/types'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import { expandHome } from '../mcp/workspace/paths'
import {
  assertPlainPath,
  dataRoot,
  inside,
  isMissing,
  managedHome,
} from './storage'

export type HomeInput = Omit<AgentHome, 'path'> & { path?: string }

/** Checks the authorized folder without creating it or following substitutions. */
export async function inspectHome(input: HomeInput) {
  const managed = managedHome(
    input.ownerId,
    input.originAgentId ?? input.agentId,
  )
  const requested = input.path ? path.resolve(expandHome(input.path)) : managed
  if (inside(dataRoot(), requested) && requested !== managed)
    throw new Error('Custom homes cannot overlap sidecar storage')
  await assertPlainPath(requested)

  try {
    const canonical = await realpath(requested)
    await assertPlainPath(canonical)
    if (inside(dataRoot(), canonical) && canonical !== managed)
      throw new Error('Custom homes cannot overlap sidecar storage')
    if (!(await stat(canonical)).isDirectory())
      throw new Error('Personal home must be a directory')
    return { path: canonical, exists: true }
  } catch (error) {
    if (!isMissing(error)) throw error
    return { path: requested, exists: false }
  }
}
