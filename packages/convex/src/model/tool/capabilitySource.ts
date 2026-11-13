import { sha256 } from '@cv/core/sha256'
import { stableStringify } from '@cv/core/stable-json'

import type { StreamContext } from '../../types'

/** Captures configuration identity without copying credentials into cached state. */
export async function capabilitySource(data: StreamContext): Promise<string> {
  return sha256(
    stableStringify({
      skills: skillCatalogSource(data),
      selection: data.agent.tools,
      role: data.invoker.role,
      parent: data.session.parent,
      disabled: data.session.settings?.disabled,
      lock: data.session.contextLock,
      shell: data.agent.shell || data.settings?.shell,
      search: data.settings?.webSearchInstances,
      interactive: data.settings?.allowInteractiveShells,
      roster: data.spawnableAgents,
      toolkits: data.toolkitContext,
      servers: data.mcpServers.map((server) => ({
        id: server.id,
        label: server.label,
        enabled: server.enabled,
        broker: server.brokerEnabled,
        toolkit: server.toolkitId,
        transport: server.transport,
        configured: !!(server.command || server.url),
        catalog: server.catalogId,
        revision: server.revision,
        tools: server.tools,
      })),
    }),
  )
}

/** Invalidates skill scans only for configuration that can change the catalog. */
export function skillCatalogSource(data: StreamContext): string {
  return stableStringify([
    data.agent.tools,
    data.invoker.role,
    data.agent.disabledSkillIds,
    data.agent.homeId,
    data.agent.home?.path,
    data.agent.home?.revision,
    data.agent.home?.catalogRevision,
    data.agent.home?.operationId,
    data.agent.fileOperationId,
    data.session.workspace?.agentOnly
      ? undefined
      : data.session.workspace?.workspaceId,
    data.session.workspace?.agentOnly
      ? undefined
      : data.session.workspace?.revision,
    data.session.workspace?.agentOnly
      ? undefined
      : data.session.workspace?.sources,
    data.toolkitSkillRevision,
  ])
}
