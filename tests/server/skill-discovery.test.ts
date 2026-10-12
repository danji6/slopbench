import { importPage } from '@sb/sidecar/agent-files/import-discovery'
import { runFileOperation } from '@sb/sidecar/agent-files/operations'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { skillZip } from '../helpers/skill-zip'

let root: string
const previousData = process.env.CHAT_SIDECAR_DATA_DIR
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'skill-discovery-'))
  process.env.CHAT_SIDECAR_DATA_DIR = path.join(root, 'data')
})
afterAll(async () => {
  if (previousData === undefined) delete process.env.CHAT_SIDECAR_DATA_DIR
  else process.env.CHAT_SIDECAR_DATA_DIR = previousData
  await rm(root, { recursive: true, force: true })
})

async function skill(directory: string, name: string) {
  await mkdir(directory, { recursive: true })
  await writeFile(
    path.join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Test ${name}.\n---\nInstructions.`,
  )
}

test('recursive discovery pages every skill, including nested and root skills, without following links', async () => {
  const source = path.join(root, 'repository')
  await skill(source, 'root-skill')
  for (let i = 0; i < 43; i++)
    await skill(
      path.join(source, 'skills', `nested-${i}`, 'deeper'),
      `skill-${i}`,
    )
  await skill(path.join(source, '.agents', 'skills', 'copy'), 'skill-0')
  await skill(path.join(source, '.git', 'ignored'), 'ignored')
  const external = path.join(root, 'external')
  await skill(external, 'external')
  await symlink(external, path.join(source, 'linked'))
  await runFileOperation({
    id: 'recursive-discovery',
    ownerId: 'owner',
    kind: 'discover-import',
    source,
  })
  let cursor = 0
  const names: string[] = []
  while (true) {
    const page = await importPage('recursive-discovery', cursor)
    expect(page.entries.length).toBeLessThanOrEqual(20)
    names.push(...page.entries.map((entry) => entry.metadata!.name))
    if (page.isDone) break
    expect(page.nextCursor).toBeGreaterThan(cursor)
    cursor = page.nextCursor
  }
  expect(names).toHaveLength(45)
  expect(names).toContain('root-skill')
  expect(names.filter((name) => name === 'skill-0')).toHaveLength(2)
  expect(names).not.toContain('ignored')
  expect(names).not.toContain('external')
  expect(await importPage('recursive-discovery', 0)).toEqual(
    await importPage('recursive-discovery', 0),
  )
})

test('repository ZIP discovery accepts multiple bundles and unrelated root files', async () => {
  const zip = skillZip([
    { name: 'repo-main/README.md', content: 'Readme' },
    { name: 'repo-main/LICENSE', content: 'MIT' },
    {
      name: 'repo-main/skills/one/SKILL.md',
      content: '---\nname: one\ndescription: First skill.\n---\nInstructions.',
    },
    {
      name: 'repo-main/skills/two/SKILL.md',
      content:
        '---\nname: two\ndescription: Second skill.\nUnindented continuation.\n---\nInstructions.',
    },
    {
      name: 'repo-main/skills/two/tool.bin',
      content: Buffer.from([0, 255, 1]),
    },
  ])
  await runFileOperation({
    id: 'repository-zip',
    ownerId: 'owner',
    kind: 'discover-import',
    fileUrl: `data:application/zip;base64,${zip.toString('base64')}`,
  })
  const page = await importPage('repository-zip', 0)
  expect(page.entries.map((entry) => entry.metadata?.name).sort()).toEqual([
    'one',
    'two',
  ])
  expect(
    page.entries.find((entry) => entry.metadata?.name === 'two')!.metadata!
      .description,
  ).toContain('Unindented continuation.')
  expect(page.isDone).toBe(true)
})

test('invalid manifests do not hide valid bundles and are reread on retry', async () => {
  const source = path.join(root, 'partially-invalid')
  await skill(path.join(source, 'good'), 'good')
  const bad = path.join(source, 'bad')
  await mkdir(bad)
  await writeFile(path.join(bad, 'SKILL.md'), 'Invalid frontmatter')
  await runFileOperation({
    id: 'invalid-discovery',
    ownerId: 'owner',
    kind: 'discover-import',
    source,
  })
  const page = await importPage('invalid-discovery', 0)
  expect(page.entries.some((entry) => entry.metadata?.name === 'good')).toBe(
    true,
  )
  expect(page.entries.find((entry) => entry.path === bad)!.error).toContain(
    'frontmatter',
  )
  await skill(bad, 'repaired')
  expect(
    (await importPage('invalid-discovery', 0)).entries.find(
      (entry) => entry.path === bad,
    )!.metadata!.name,
  ).toBe('repaired')
})
