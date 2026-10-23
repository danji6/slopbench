'use node'

import type { IntegrationSnapshot } from '@sb/core/types/integration'

import { api, internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { extractErrorMessage } from '../../errors'
import { authorizeAdmin } from '../../functions'
import type { IntegrationPublishArgs, StreamExecutionArgs } from '../../types'
import { integrationRequest } from './transport'

export type ProjectIntegrationDiscovery = {
  root: string
  label: string
  snapshot?: Inspection
  diagnostic?: string
}

type Inspection = IntegrationSnapshot & {
  connections: IntegrationPublishArgs['connections']
}

export async function link(
  ctx: ActionCtx,
  root: string,
): Promise<Id<'integrations'>> {
  const { subject } = await authorizeAdmin(ctx)
  const inspection = await integrationRequest<Inspection>('inspect', { root })
  return ctx.runMutation(internal.integrations._publish, {
    subject,
    ...publicationFields(inspection),
  })
}

export async function refresh(
  ctx: ActionCtx,
  integrationId: Id<'integrations'>,
): Promise<{ integrationId: Id<'integrations'>; changed: boolean }> {
  const { subject } = await authorizeAdmin(ctx)
  const row = await ctx.runQuery(api.integrations.get, { integrationId })
  try {
    const inspection = await integrationRequest<Inspection>('inspect', {
      root: row.root,
    })
    await ctx.runMutation(internal.integrations._publish, {
      subject,
      integrationId,
      previousRevision: row.revision,
      ...publicationFields(inspection),
    })
    return { integrationId, changed: inspection.revision !== row.revision }
  } catch (cause) {
    await ctx.runMutation(internal.integrations._missing, {
      subject,
      integrationId,
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
): Promise<ProjectIntegrationDiscovery[]> {
  await authorizeAdmin(ctx)
  const sources = await ctx.runQuery(api.integrations.sources, { sessionId })
  return Promise.all(
    sources.map(async (source) => {
      try {
        const inspection = await integrationRequest<Inspection>('inspect', {
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
export async function observeLinkedIntegrations(
  ctx: ActionCtx,
  execution: StreamExecutionArgs,
): Promise<string[]> {
  const invalidated: string[] = []
  const rows = await ctx.runQuery(internal.integrations._execution, execution)
  for (const row of rows) {
    let snapshot: Inspection
    try {
      snapshot = await integrationRequest<Inspection>('inspect', {
        root: row.root,
      })
    } catch (cause) {
      await ctx.runMutation(internal.integrations._observe, {
        ...execution,
        integrationId: row._id,
        acceptedRevision: row.revision,
        diagnostic: extractErrorMessage(cause),
      })
      invalidated.push(row._id)
      continue
    }
    if (snapshot.revision === row.revision) continue
    await ctx.runMutation(internal.integrations._observe, {
      ...execution,
      integrationId: row._id,
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
