import { projectSkillCatalog } from '@sb/sidecar/agent-files/project-catalog'
import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

async function skill(
  root: string,
  name: string,
  description = name,
  body = 'Instructions',
) {
  const directory = path.join(root, '.agents/skills', name)
  await mkdir(directory, { recursive: true })
  await writeFile(
    path.join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n${body}`,
  )
}

test('project discovery stays at its selected root and returns bounded, deterministic pages', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'project-skills-'))
  try {
    for (let i = 0; i < 43; i++)
      await skill(root, `skill-${String(i).padStart(3, '0')}`)
    await skill(path.join(root, 'nested'), 'nested-skill')
    await skill(path.join(root, '.claude'), 'other-skill')
    await mkdir(path.join(root, '.agents/skills/not-a-skill'), {
      recursive: true,
    })
    const input = { root, label: 'Repository', offset: 0, limit: 20 }
    const first = await projectSkillCatalog(input)
    const second = await projectSkillCatalog({ ...input, offset: 20 })
    const last = await projectSkillCatalog({ ...input, offset: 40 })
    expect(first.total).toBe(43)
    expect(first.entries).toHaveLength(20)
    expect(last.entries).toHaveLength(3)
    expect(
      new Set(
        [...first.entries, ...second.entries, ...last.entries].map(
          (entry) => entry.path,
        ),
      ).size,
    ).toBe(43)
    expect(first.entries[0]).toMatchObject({
      name: 'skill-000',
      origin: 'Project: Repository',
    })
    expect(first.fingerprint).toBe(second.fingerprint)
    await skill(root, 'skill-042', 'skill-042', 'Edited body')
    expect((await projectSkillCatalog(input)).fingerprint).toBe(
      first.fingerprint,
    )
    await skill(root, 'skill-042', 'Changed metadata')
    expect((await projectSkillCatalog(input)).fingerprint).not.toBe(
      first.fingerprint,
    )
    expect(
      (await projectSkillCatalog({ ...input, search: 'skill-04' })).entries,
    ).toHaveLength(3)
    const compact = await projectSkillCatalog({
      ...input,
      limit: 10000,
      characterBudget: 200,
    })
    expect(compact.entries.length).toBeLessThan(43)
    expect(
      (
        await projectSkillCatalog({
          ...input,
          root: path.join(root, 'missing'),
        })
      ).entries,
    ).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('invalid manifests and symlinks are diagnosed without granting access to their targets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'project-skills-'))
  try {
    await skill(root, 'good')
    await skill(root, 'bad')
    await writeFile(
      path.join(root, '.agents/skills/bad/SKILL.md'),
      'Not a skill',
    )
    await symlink(
      path.join(root, '.agents/skills/good'),
      path.join(root, '.agents/skills/linked'),
    )
    const result = await projectSkillCatalog({
      root,
      label: 'Repo',
      offset: 0,
      limit: 20,
    })
    expect(
      result.entries.find((entry) => entry.name === 'good')?.error,
    ).toBeUndefined()
    expect(
      result.entries.find((entry) => entry.name === 'bad')?.error,
    ).toContain('frontmatter')
    expect(
      result.entries.find((entry) => entry.name === 'linked')?.error,
    ).toContain('Symlink')
    expect(
      (
        await projectSkillCatalog({
          root,
          label: 'Repo',
          offset: 0,
          limit: 20,
          agentDir: root,
        })
      ).entries,
    ).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
