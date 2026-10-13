import { realpath } from 'node:fs/promises'
import path from 'node:path'

import { expandHome } from '../mcp/workspace/paths'
import { inspectHome } from './home-state'
import { assertPlainPath, dataRoot, inside, managedHome } from './storage'

/** Resolves a selection before the backend reserves its canonical home identity. */
export async function resolveDestination(input: {
  ownerId: string
  agentId: string
  originAgentId?: string
  path?: string
}) {
  const origin = input.originAgentId ?? input.agentId
  const managed = managedHome(input.ownerId, origin)
  const selectsManaged =
    !input.path || path.resolve(expandHome(input.path)) === managed
  const target =
    !selectsManaged && input.path
      ? await realpath(path.resolve(expandHome(input.path)))
      : (await inspectHome({ ...input, originAgentId: origin, revision: 0 }))
          .path
  await assertPlainPath(target)
  return {
    path: target,
    insideData: inside(dataRoot(), target),
  }
}
