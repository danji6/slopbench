'use node'

import { sha256 } from '@sb/core/sha256'
import { contextDependencies, contextEnabled } from '@sb/core/tool-context'

import { internal } from '../../_generated/api'
import type { ActionCtx } from '../../_generated/server'
import { buildWorkspaceNoteContent } from '../../model/chat/notes'
import { prepareMcpCatalogContext } from '../../model/mcpCatalogContext'
import { catalogNote, compactSkillCatalog } from '../../model/skills/runtime'
import type { StreamContext, StreamExecutionArgs } from '../../types'

/** Prepares only context whose capabilities are exposed by this frozen manifest. */
export async function prepareToolContext(
  ctx: ActionCtx,
  execution: StreamExecutionArgs,
  data: StreamContext,
  names: string[],
) {
  if (!['invoke', 'retry'].includes(data.stream.command.kind)) return true

  if (contextEnabled('mcp', names)) {
    const prepared = await prepareMcpCatalogContext(ctx, execution, data, names)
    if (!prepared) return false
  }

  const preparesWorkspace =
    contextEnabled('workspace', names) && !data.stream.workspaceContextPrepared
  if (preparesWorkspace) {
    const prepared = await prepareWorkspace(ctx, execution, data, names)
    if (!prepared) return false
  }

  const preparesSkills =
    contextEnabled('skills', names) && !data.stream.skillContextPrepared
  if (preparesSkills) {
    return prepareSkills(ctx, execution, data, names)
  }

  return true
}

async function prepareWorkspace(
  ctx: ActionCtx,
  execution: StreamExecutionArgs,
  data: StreamContext,
  names: string[],
) {
  const content = buildWorkspaceNoteContent(
    undefined,
    data.session.workspace,
    names,
  )
  const capabilities = contextDependencies('workspace', names)
  return ctx.runMutation(internal.streams._prepareWorkspaceContext, {
    ...execution,
    capabilities,
    fingerprint: await sha256(JSON.stringify([content, capabilities])),
    label: data.session.workspace?.label,
    content:
      content ||
      'No project sources or personal folder are currently available. Earlier filesystem context no longer applies.',
  })
}

async function prepareSkills(
  ctx: ActionCtx,
  execution: StreamExecutionArgs,
  data: StreamContext,
  names: string[],
) {
  const page = await compactSkillCatalog(
    ctx,
    data.agent,
    data.session.workspace,
    data.session._id,
  )
  const capabilities = contextDependencies('skills', names)
  return ctx.runMutation(internal.streams._prepareSkillContext, {
    ...execution,
    capabilities,
    fingerprint: await sha256(JSON.stringify([page.fingerprint, capabilities])),
    integrationFingerprint: page.integrationFingerprint,
    content:
      catalogNote(page, names) ||
      'No skills are currently available. Earlier skill catalogs no longer apply.',
  })
}
