import type { ActionCtx } from '@sb/convex/_generated/server'
import { combinedSkillCatalog } from '@sb/convex/model/skills/catalog'
import { assignments } from '@sb/convex/model/skills/endpoints'
import { catalogNote } from '@sb/convex/model/skills/runtime'
import type { AgentWithHome } from '@sb/convex/types'
import { SKILL_CATALOG_CHARACTERS } from '@sb/core/skills/catalog'
import type { FolderWorkspace } from '@sb/core/types/workspace'
import { readSkillMetadata } from '@sb/sidecar/agent-files/metadata'
import { projectSkillCatalog } from '@sb/sidecar/agent-files/project-catalog'
import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { skillsDatabase } from '../helpers/skills-db'

async function writeSkill(
  root: string,
  name: string,
  description = 'A workflow '.repeat(20),
) {
  await mkdir(path.join(root, name), { recursive: true })
  await writeFile(
    path.join(root, name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\nInstructions`,
  )
}

test('combined catalogs preserve origins, page across sources, and reject stale continuations', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'combined-skills-'))
  const original = globalThis.fetch
  const secret = process.env.SIDECAR_SECRET
  const fixture = skillsDatabase()
  const home = path.join(root, 'home')
  const project = path.join(root, 'repo')
  const second = path.join(root, 'second')
  const agent = {
    _id: 'agent',
    ownerId: 'owner',
    homeId: 'home',
    home: { path: home },
  } as AgentWithHome
  const workspace = {
    path: project,
    agentHome: { path: home },
    sources: [
      { id: 'project', path: project, label: 'Repo', discoverSkills: true },
      { id: 'second', path: second, label: 'Second', discoverSkills: true },
      {
        id: 'duplicate',
        path: project,
        label: 'Duplicate',
        discoverSkills: true,
      },
      { id: 'disabled', path: root, label: 'Disabled', discoverSkills: false },
    ],
  } as FolderWorkspace
  fixture.rows('agents').push(agent)
  process.env.SIDECAR_SECRET = 'fixture-secret'
  globalThis.fetch = (async (url, init) => {
    const input = JSON.parse(String(init?.body))
    if (String(url).endsWith('/project-catalog'))
      return Response.json(await projectSkillCatalog(input))
    return Response.json({
      entries: await Promise.all(
        input.names.map(async (name: string) => ({
          ...(await readSkillMetadata(path.join(home, 'skills', name))),
          path: `agent://skills/${name}/SKILL.md`,
        })),
      ),
    })
  }) as typeof fetch
  const ctx = {
    runQuery: (_ref: unknown, input: unknown) =>
      assignments(fixture.ctx, input as never),
  } as unknown as ActionCtx
  try {
    await writeSkill(path.join(home, 'skills'), 'review')
    fixture.rows('agentSkills').push({
      _id: 'assignment',
      homeId: 'home',
      ownerId: 'owner',
      name: 'review',
      skillId: 'skill',
    })
    await writeSkill(path.join(project, '.agents/skills'), 'review')
    for (let i = 0; i < 42; i++)
      await writeSkill(
        path.join(project, '.agents/skills'),
        `skill-${String(i).padStart(2, '0')}`,
      )
    await writeSkill(path.join(second, '.agents/skills'), 'review')
    const compact = await combinedSkillCatalog(ctx, agent, workspace, {
      compact: true,
    })
    expect(catalogNote(compact).length).toBeLessThanOrEqual(
      SKILL_CATALOG_CHARACTERS,
    )
    expect(compact.isDone).toBe(false)
    const all = [...compact.entries]
    let cursor = compact.cursor
    while (cursor) {
      const next = await combinedSkillCatalog(ctx, agent, workspace, { cursor })
      expect(next.entries.length).toBeLessThanOrEqual(20)
      all.push(...next.entries)
      cursor = next.cursor
    }
    expect(all).toHaveLength(45)
    expect(new Set(all.map((entry) => entry.path)).size).toBe(45)
    expect(
      all
        .filter((entry) => entry.name === 'review')
        .map((entry) => entry.origin),
    ).toEqual(['Agent', 'Project: Repo', 'Project: Second'])
    const unchanged = await combinedSkillCatalog(ctx, agent, {
      ...workspace,
      sources: [
        ...workspace.sources!,
        {
          id: 'empty',
          path: path.join(root, 'empty'),
          label: 'Empty',
          discoverSkills: true,
        },
      ],
    })
    expect(unchanged.fingerprint).toBe(compact.fingerprint)
    const first = await combinedSkillCatalog(ctx, agent, workspace)
    await writeSkill(
      path.join(second, '.agents/skills'),
      'review',
      'Changed beyond the first page',
    )
    await expect(
      combinedSkillCatalog(ctx, agent, workspace, { cursor: first.cursor }),
    ).rejects.toThrow('Restart list_skills')
    const searched = await combinedSkillCatalog(ctx, agent, workspace, {
      search: 'review',
    })
    expect(searched.entries).toHaveLength(3)
    workspace.sources![0]!.discoverSkills = false
    workspace.sources![2]!.discoverSkills = false
    agent.disabledSkillIds = ['skill' as never]
    expect(
      (await combinedSkillCatalog(ctx, agent, workspace)).entries.map(
        (entry) => entry.origin,
      ),
    ).toEqual(['Project: Second'])
  } finally {
    globalThis.fetch = original
    if (secret === undefined) delete process.env.SIDECAR_SECRET
    else process.env.SIDECAR_SECRET = secret
    await rm(root, { recursive: true, force: true })
  }
})
