'use node'

import type { SkillCatalogSlice } from '@sb/core/skills/types'

import { api } from '../../_generated/api'
import type { ActionCtx } from '../../_generated/server'
import { error } from '../../errors'
import { authorizeAdmin } from '../../functions'
import type { ToolkitSkillsArgs } from '../../types'
import { toolkitRequest } from './transport'

export type ToolkitSkillPreview = SkillCatalogSlice & {
  nextOffset: number | null
}

/** Lists sibling metadata without exposing instructions or starting processes. */
export async function previewSkills(
  ctx: ActionCtx,
  args: ToolkitSkillsArgs,
): Promise<ToolkitSkillPreview> {
  await authorizeAdmin(ctx)

  if (!Number.isSafeInteger(args.offset) || args.offset < 0) {
    error('Invalid skill offset', 400)
  }

  const row = await ctx.runQuery(api.toolkits.get, {
    toolkitId: args.toolkitId,
  })
  const page = await toolkitRequest<SkillCatalogSlice>('catalog', {
    sources: [
      {
        root: row.root,
        origin: `Toolkit: ${row.name}`,
        toolkitId: row._id,
        revision: row.revision,
      },
    ],
    offset: args.offset,
    limit: 20,
  })

  if (args.offset > page.total) {
    error('Skill offset is out of range', 400)
  }
  if (args.fingerprint && args.fingerprint !== page.fingerprint) {
    error('Skill catalog changed. Reload the components.', 409)
  }

  const next = args.offset + page.entries.length
  return { ...page, nextOffset: next < page.total ? next : null }
}
