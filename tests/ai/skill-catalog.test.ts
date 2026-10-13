import type { Doc } from '@sb/convex/_generated/dataModel'
import type { ActionCtx } from '@sb/convex/_generated/server'
import {
  catalogNote,
  compactSkillCatalog,
  readSkillCatalog,
} from '@sb/convex/model/skills/runtime'
import { SKILL_CATALOG_CHARACTERS } from '@sb/core/skills/catalog'
import type { FolderWorkspace } from '@sb/core/types/workspace'
import { expect, test } from 'bun:test'

const agent = { _id: 'agent', ownerId: 'owner' } as Doc<'agents'>
const workspace = { path: '/home' } as FolderWorkspace

async function catalogFixture(
  count: number,
  run: (ctx: ActionCtx) => Promise<void>,
) {
  const original = globalThis.fetch
  const secret = process.env.SIDECAR_SECRET
  process.env.SIDECAR_SECRET = 'fixture-secret'
  const entries = Array.from({ length: count }, (_, i) => ({
    name: `skill-${String(i).padStart(3, '0')}`,
  }))
  globalThis.fetch = (async (_input, init) => {
    const { names } = JSON.parse(String(init?.body)) as { names: string[] }
    return Response.json({
      entries: names.map((name) => ({
        name,
        description: 'A long workflow description. '.repeat(30),
        path: `.agents/skills/${name}/SKILL.md`,
      })),
    })
  }) as typeof fetch
  const ctx = {
    runQuery: async (
      _ref: unknown,
      args: { paginationOpts: { cursor: string | null; numItems: number } },
    ) => {
      const start = Number(args.paginationOpts.cursor ?? 0)
      const end = start + args.paginationOpts.numItems
      return {
        page: entries.slice(start, end),
        continueCursor: String(end),
        isDone: end >= entries.length,
      }
    },
  } as unknown as ActionCtx
  try {
    await run(ctx)
  } finally {
    globalThis.fetch = original
    if (secret === undefined) delete process.env.SIDECAR_SECRET
    else process.env.SIDECAR_SECRET = secret
  }
}

test('ordinary catalogs include more than one database page without extra agent calls', async () => {
  await catalogFixture(35, async (ctx) => {
    const result = await compactSkillCatalog(ctx, agent, workspace)
    expect(result.entries).toHaveLength(35)
    expect(result.isDone).toBe(true)
    expect(catalogNote(result).length).toBeLessThanOrEqual(
      SKILL_CATALOG_CHARACTERS,
    )
    expect(catalogNote(result)).not.toContain('absolute path:')
  })
})

test('budgeted catalogs retain an exact continuation without dropping or repeating skills', async () => {
  await catalogFixture(150, async (ctx) => {
    let result = await compactSkillCatalog(ctx, agent, workspace)
    expect(result.isDone).toBe(false)
    expect(catalogNote(result).length).toBeLessThanOrEqual(
      SKILL_CATALOG_CHARACTERS,
    )
    const names = result.entries.map((entry) => entry.name)
    while (!result.isDone) {
      result = await readSkillCatalog(ctx, agent, workspace, result.cursor)
      names.push(...result.entries.map((entry) => entry.name))
    }
    expect(names).toHaveLength(150)
    expect(new Set(names).size).toBe(150)
    expect(names.at(-1)).toBe('skill-149')
  })
})
