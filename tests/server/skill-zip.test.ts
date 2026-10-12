import { skillUploadHeader } from '@sb/core/skills/upload'
import { runFileOperation } from '@sb/sidecar/agent-files/operations'
import { libraryRoot } from '@sb/sidecar/agent-files/storage'
import { verifySkillUpload } from '@sb/sidecar/agent-files/upload'
import { extractSkillZip } from '@sb/sidecar/agent-files/zip'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { skillZip } from '../helpers/skill-zip'

let root: string
const previousData = process.env.CHAT_SIDECAR_DATA_DIR
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'skill-zip-'))
  process.env.CHAT_SIDECAR_DATA_DIR = path.join(root, 'data')
})
afterAll(async () => {
  if (previousData === undefined) {
    delete process.env.CHAT_SIDECAR_DATA_DIR
  } else {
    process.env.CHAT_SIDECAR_DATA_DIR = previousData
  }
  await rm(root, { recursive: true, force: true })
})

test('ZIP installation preserves complete bundles and executable resources', async () => {
  const zip = skillZip([
    {
      name: 'enclosing/SKILL.md',
      content:
        '---\nname: review\ndescription: Review changes.\n---\nRead references/checklist.md.',
    },
    {
      name: 'enclosing/scripts/check.sh',
      content: '#!/bin/sh\necho check\n',
      mode: 0o100755,
    },
    { name: 'enclosing/references/checklist.md', content: 'Verify behavior.' },
    { name: 'enclosing/tool.bin', content: Buffer.from([0, 1, 2, 255]) },
    {
      name: 'enclosing/agents/openai.yaml',
      content: 'interface:\n  display_name: Review',
    },
  ])
  const result = await runFileOperation({
    kind: 'install',
    id: 'zip-install',
    ownerId: 'owner',
    skillId: 'zip',
    fileUrl: `data:application/zip;base64,${zip.toString('base64')}`,
  })
  expect(result).toEqual({ name: 'review', description: 'Review changes.' })
  const bundle = path.join(libraryRoot('owner', 'zip'), 'review')
  expect(await readFile(path.join(bundle, 'tool.bin'))).toEqual(
    Buffer.from([0, 1, 2, 255]),
  )
  expect((await stat(path.join(bundle, 'scripts/check.sh'))).mode & 0o111).toBe(
    0o111,
  )
  expect(
    await readFile(path.join(bundle, 'agents/openai.yaml'), 'utf8'),
  ).toContain('display_name')
})

test.each([
  { label: 'traversal', entries: [{ name: '../outside', content: 'escape' }] },
  {
    label: 'absolute path',
    entries: [{ name: '/outside', content: 'escape' }],
  },
  {
    label: 'symlink',
    entries: [{ name: 'link', content: 'outside', mode: 0o120777 }],
  },
  {
    label: 'duplicate target',
    entries: [
      { name: 'file', content: 'one' },
      { name: 'file', content: 'two' },
    ],
  },
])(
  'rejects $label without publishing the archive',
  async ({ label, entries }) => {
    const filename = path.join(root, `${label}.zip`)
    const destination = path.join(root, label)
    await writeFile(filename, skillZip(entries))
    await mkdir(destination)
    await expect(extractSkillZip(filename, destination)).rejects.toThrow()
    await expect(stat(path.join(root, 'outside'))).rejects.toThrow()
  },
)

test('ownership envelope prevents importing or cleaning up another blob by storage id', async () => {
  const ticket = 'owned-ticket'
  const wrapped = Buffer.concat([
    Buffer.from(skillUploadHeader(ticket)),
    skillZip([
      {
        name: 'SKILL.md',
        content:
          '---\nname: enveloped\ndescription: Ownership fixture.\n---\nInstructions.',
      },
    ]),
  ])
  const fileUrl = `data:application/octet-stream;base64,${wrapped.toString('base64')}`
  expect(await verifySkillUpload(fileUrl, ticket)).toBe(true)
  expect(await verifySkillUpload(fileUrl, 'another-ticket')).toBe(false)
  const result = await runFileOperation({
    kind: 'install',
    id: 'enveloped-install',
    ownerId: 'owner',
    skillId: 'enveloped',
    fileUrl,
    ticket,
  })
  expect(result).toEqual({
    name: 'enveloped',
    description: 'Ownership fixture.',
  })
})
