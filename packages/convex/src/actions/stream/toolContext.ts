'use node'

import { sha256 } from '@sb/core/sha256'
import { contextDependencies, contextEnabled } from '@sb/core/tool-context'

import { internal } from '../../_generated/api'
import type { ActionCtx } from '../../_generated/server'
import { buildWorkspaceNoteContent } from '../../model/chat/notes'
import { prepareMcpCatalogContext } from '../../model/mcpCatalogContext'
import { catalogNote } from '../../model/skills/runtime'
import type { PreparedAvailability } from '../../model/tool/availability'
import type { StreamContext, StreamExecutionArgs } from '../../types'

/** Appends current context without changing earlier notes or the frozen prefix. */
export async function prepareToolContext(
  ctx: ActionCtx,
  execution: StreamExecutionArgs,
  data: StreamContext,
  names: string[],
  contextId?: string,
  availability?: PreparedAvailability,
) {
  if (!['invoke', 'retry'].includes(data.stream.command.kind)) return true

  const previous =
    data.sessionCache?.effectiveTools?.names ??
    data.sessionCache?.tools?.names ??
    []
  if (contextEnabled('mcp', names)) {
    const prepared = await prepareMcpCatalogContext(
      ctx,
      execution,
      data,
      names,
      contextId,
    )
    if (!prepared) return false
  } else if (contextEnabled('mcp', previous)) {
    const prepared = await ctx.runMutation(
      internal.streams._prepareMcpContext,
      {
        ...execution,
        contextId,
        capabilities: [],
        fingerprint: 'disabled',
        content:
          'MCP tools are no longer available. Earlier MCP catalogs no longer authorize calls.',
      },
    )
    if (!prepared) return false
  }

  const preparesWorkspace =
    contextEnabled('workspace', names) || contextEnabled('workspace', previous)
  if (preparesWorkspace) {
    const prepared = await prepareWorkspace(
      ctx,
      execution,
      data,
      names,
      contextId,
    )
    if (!prepared) return false
  }

  const preparesSkills =
    (!!availability?.catalog && names.includes('list_skills')) ||
    (!names.includes('list_skills') && previous.includes('list_skills'))
  if (preparesSkills) {
    return prepareSkills(ctx, execution, names, contextId, availability)
  }

  return true
}

async function prepareWorkspace(
  ctx: ActionCtx,
  execution: StreamExecutionArgs,
  data: StreamContext,
  names: string[],
  contextId?: string,
) {
  const content = contextEnabled('workspace', names)
    ? buildWorkspaceNoteContent(undefined, data.session.workspace, names)
    : 'Filesystem tools are disabled. Earlier filesystem context no longer authorizes access.'
  const capabilities = contextDependencies('workspace', names)
  return ctx.runMutation(internal.streams._prepareWorkspaceContext, {
    ...execution,
    contextId,
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
  names: string[],
  contextId?: string,
  availability?: PreparedAvailability,
) {
  const page = availability?.catalog
  const capabilities = contextDependencies('skills', names)
  return ctx.runMutation(internal.streams._prepareSkillContext, {
    ...execution,
    contextId,
    capabilities,
    fingerprint: await sha256(
      JSON.stringify([page?.fingerprint ?? 'disabled', capabilities]),
    ),
    toolkitFingerprint: page?.toolkitFingerprint,
    content:
      (page && names.includes('list_skills') ? catalogNote(page, names) : '') ||
      'No skills are currently available. Earlier skill catalogs no longer apply.',
  })
}
