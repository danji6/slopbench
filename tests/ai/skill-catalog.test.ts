import type { ActionCtx } from '@sb/convex/_generated/server'
import { assignments } from '@sb/convex/model/skills/endpoints'
import {
  catalogForTool,
  catalogNote,
  compactSkillCatalog,
  readSkillCatalog,
} from '@sb/convex/model/skills/runtime'
import type { AgentWithHome, SkillAssignmentsArgs } from '@sb/convex/types'
import { SKILL_CATALOG_CHARACTERS } from '@sb/core/skills/catalog'
import type { FolderWorkspace } from '@sb/core/types/workspace'
import {
  integrationCatalogSchema,
  integrationSkillCatalog,
} from '@sb/sidecar/integrations/catalog'
import { expect, test } from 'bun:test'
import { getFunctionName } from 'convex/server'

import { skillsDatabase } from '../helpers/skills-db'

const agent = {
  _id: 'agent',
  ownerId: 'owner',
  homeId: 'home',
  home: { path: '/home' },
} as AgentWithHome
const workspace = {
  path: '/home',
  agentHome: { path: '/home' },
} as FolderWorkspace

async function catalogFixture(
  count: number,
  run: (ctx: ActionCtx) => Promise<void>,
  disabled: string[] = [],
) {
  const original = globalThis.fetch
  const secret = process.env.SIDECAR_SECRET
  process.env.SIDECAR_SECRET = 'fixture-secret'
  const entries = Array.from({ length: count }, (_, i) => ({
    name: `skill-${String(i).padStart(3, '0')}`,
  }))
  const database = skillsDatabase()
  database.rows('agents').push({ ...agent, disabledSkillIds: disabled })
  database.rows('agentSkills').push(
    ...entries.map((entry) => ({
      ...entry,
      _id: `assignment-${entry.name}`,
      homeId: agent.homeId,
      skillId: entry.name,
    })),
  )
  globalThis.fetch = (async (_input, init) => {
    if (String(_input).endsWith('/integrations/catalog'))
      return Response.json(
        await integrationSkillCatalog(
          integrationCatalogSchema.parse(JSON.parse(String(init?.body))),
        ),
      )
    const { names } = JSON.parse(String(init?.body)) as { names: string[] }
    return Response.json({
      entries: names.map((name) => ({
        name,
        description: 'A workflow description. '.repeat(5),
        path: `agent://skills/${name}/SKILL.md`,
      })),
    })
  }) as typeof fetch
  const ctx = {
    runQuery: async (
      ref: Parameters<typeof getFunctionName>[0],
      args: SkillAssignmentsArgs,
    ) => {
      if (getFunctionName(ref) === 'skills:_agent') return agent
      return assignments(database.ctx, args)
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

test('disabled skills are omitted from prompt and tool catalogs across empty pages and continuations', async () => {
  const disabled = Array.from(
    { length: 25 },
    (_, i) => `skill-${String(i).padStart(3, '0')}`,
  )
  await catalogFixture(
    150,
    async (ctx) => {
      const compact = await compactSkillCatalog(ctx, agent, workspace)
      expect(compact.entries[0]!.name).toBe('skill-025')
      expect(catalogNote(compact)).not.toContain('skill-000')
      expect(catalogNote(compact).length).toBeLessThanOrEqual(
        SKILL_CATALOG_CHARACTERS,
      )
      const names = compact.entries.map((entry) => entry.name)
      let cursor = compact.cursor
      while (cursor) {
        const next = await catalogForTool(ctx, agent._id, workspace, { cursor })
        names.push(...next.entries.map((entry) => entry.name))
        cursor = next.cursor
      }
      expect(names).toHaveLength(125)
      expect(new Set(names).size).toBe(125)
      expect(names.at(-1)).toBe('skill-149')
      const search = await catalogForTool(ctx, agent._id, workspace, {
        search: 'skill-02',
      })
      expect(search.entries.map((entry) => entry.name)).toEqual([
        'skill-025',
        'skill-026',
        'skill-027',
        'skill-028',
        'skill-029',
      ])
    },
    disabled,
  )
})

test('disabling every skill removes the generated skill reminder', async () => {
  await catalogFixture(
    2,
    async (ctx) => {
      const result = await compactSkillCatalog(ctx, agent, workspace)
      expect(result.entries).toEqual([])
      expect(result.isDone).toBe(true)
      expect(catalogNote(result)).toBe('')
    },
    ['skill-000', 'skill-001'],
  )
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
