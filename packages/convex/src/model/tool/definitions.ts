'use node'

import type { ToolSet } from 'ai'

import type { ActionCtx } from '../../_generated/server'
import type { StreamExecutionArgs } from '../../types'
import type { ToolDefinition, ToolManifest } from './manifest'

/** Serializes the exact function definitions independently of their live behavior. */
export async function toolDefinitions(
  tools: ToolSet,
): Promise<ToolDefinition[]> {
  const { asSchema } = await import('ai')
  return Promise.all(
    Object.entries(tools).map(async ([name, definition]) => ({
      name,
      description:
        typeof definition.description === 'string'
          ? definition.description
          : undefined,
      inputSchema: JSON.stringify(
        await asSchema(definition.inputSchema).jsonSchema,
      ),
    })),
  )
}

/** Keeps immutable MCP blobs referenced rather than copying large schemas into Convex rows. */
export function compactDefinitions(
  manifest: ToolManifest,
  definitions: ToolDefinition[],
): ToolDefinition[] {
  return definitions.map((definition) => {
    const external = manifest.mcp?.find(
      (entry) => entry.name === definition.name,
    )
    return external?.definitionRef
      ? {
          name: definition.name,
          inputSchema: '',
          description: external.description,
          definitionRef: external.definitionRef,
        }
      : definition
  })
}

/** Materializes the owning snapshot's pinned definitions even after a tool is disabled. */
export async function frozenDefinitions(
  ctx: ActionCtx,
  manifest: ToolManifest,
  execution: StreamExecutionArgs,
): Promise<ToolDefinition[]> {
  const { loadMcpDefinition } = await import('./mcpDefinition')
  return Promise.all(
    (manifest.definitions ?? []).map(async (entry) => {
      if (!entry.definitionRef) return entry
      const definition = await loadMcpDefinition(
        ctx,
        entry.definitionRef,
        execution,
      )
      return {
        name: entry.name,
        description: entry.description ?? definition.description,
        inputSchema: definition.inputSchema,
      }
    }),
  )
}
