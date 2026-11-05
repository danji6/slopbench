'use node'

import type { ToolkitSnapshot } from '@sb/core/types/toolkit'

import { api, internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { extractErrorMessage } from '../../errors'
import { authorizeAdmin } from '../../functions'
import type { StreamExecutionArgs, ToolkitPublishArgs } from '../../types'
import { toolkitRequest } from './transport'

export type ProjectToolkitDiscovery = {
  root: string
  label: string
  snapshot?: Inspection
  diagnostic?: string
}

type Inspection = ToolkitSnapshot & {
  connections: ToolkitPublishArgs['connections']
}

export async function link(
  ctx: ActionCtx,
  root: string,
): Promise<Id<'toolkits'>> {
  const { subject } = await authorizeAdmin(ctx)
  const inspection = await toolkitRequest<Inspection>('inspect', { root })
  return ctx.runMutation(internal.toolkits._publish, {
    subject,
    ...publicationFields(inspection),
  })
}

export async function refresh(
  ctx: ActionCtx,
  toolkitId: Id<'toolkits'>,
): Promise<{ toolkitId: Id<'toolkits'>; changed: boolean }> {
  const { subject } = await authorizeAdmin(ctx)
  const row = await ctx.runQuery(api.toolkits.get, { toolkitId })
  try {
    const inspection = await toolkitRequest<Inspection>('inspect', {
      root: row.root,
    })
    await ctx.runMutation(internal.toolkits._publish, {
      subject,
      toolkitId,
      previousRevision: row.revision,
      ...publicationFields(inspection),
    })
    return { toolkitId, changed: inspection.revision !== row.revision }
  } catch (cause) {
    await ctx.runMutation(internal.toolkits._missing, {
      subject,
      toolkitId,
      acceptedRevision: row.revision,
      diagnostic: extractErrorMessage(cause),
    })
    throw cause
  }
}

/** Inspects only explicitly opted-in source roots; discovery never registers or launches. */
export async function discover(
  ctx: ActionCtx,
  sessionId: Id<'sessions'>,
): Promise<ProjectToolkitDiscovery[]> {
  await authorizeAdmin(ctx)
  const sources = await ctx.runQuery(api.toolkits.sources, { sessionId })
  return Promise.all(
    sources.map(async (source) => {
      try {
        const inspection = await toolkitRequest<Inspection>('inspect', {
          root: source.path,
        })
        return { root: source.path, label: source.label, snapshot: inspection }
      } catch (cause) {
        return {
          root: source.path,
          label: source.label,
          diagnostic: extractErrorMessage(cause),
        }
      }
    }),
  )
}

/** Checks selected linked roots without launching any processes. */
export async function observeLinkedToolkits(
  ctx: ActionCtx,
  execution: StreamExecutionArgs,
): Promise<string[]> {
  const invalidated: string[] = []
  const rows = await ctx.runQuery(internal.toolkits._execution, execution)
  for (const row of rows) {
    let snapshot: Inspection
    try {
      snapshot = await toolkitRequest<Inspection>('inspect', {
        root: row.root,
      })
    } catch (cause) {
      await ctx.runMutation(internal.toolkits._observe, {
        ...execution,
        toolkitId: row._id,
        acceptedRevision: row.revision,
        diagnostic: extractErrorMessage(cause),
      })
      invalidated.push(row._id)
      continue
    }
    if (snapshot.revision === row.revision) continue
    await ctx.runMutation(internal.toolkits._observe, {
      ...execution,
      toolkitId: row._id,
      acceptedRevision: row.revision,
      observedRevision: snapshot.revision,
    })
    invalidated.push(row._id)
  }
  return invalidated
}

function publicationFields(inspection: Inspection) {
  return {
    root: inspection.root,
    revision: inspection.revision,
    manifest: JSON.stringify(inspection.manifest),
    connections: inspection.connections,
  }
}
