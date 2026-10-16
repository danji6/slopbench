import { selectFileWorkspace, withAgentHome } from '@sb/core/workspace/personal'
import { runFileOperation } from '@sb/sidecar/agent-files/operations'
import { managedHome } from '@sb/sidecar/agent-files/storage'
import {
  createFileExistsHelper,
  createFileHelper,
} from '@sb/sidecar/eval/file-helper'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

let root: string
let project: string
let personal: string
const oldData = process.env.CHAT_SIDECAR_DATA_DIR
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'explicit-personal-'))
  project = path.join(root, 'project')
  personal = path.join(root, 'home')
  await mkdir(project)
  await mkdir(personal)
  await writeFile(path.join(personal, 'note.txt'), 'Personal note')
  process.env.CHAT_SIDECAR_DATA_DIR = path.join(root, 'data')
})
afterAll(async () => {
  if (oldData === undefined) delete process.env.CHAT_SIDECAR_DATA_DIR
  else process.env.CHAT_SIDECAR_DATA_DIR = oldData
  await rm(root, { recursive: true, force: true })
})

test('both absolute and relative home access require an explicit scope', () => {
  const home = { agentId: 'a', ownerId: 'owner', path: personal, revision: 0 }
  const workspace = withAgentHome(
    { workspaceId: 'project', path: project, label: 'Project' },
    home,
  )
  expect(() =>
    selectFileWorkspace(workspace, undefined, path.join(personal, 'note.txt')),
  ).toThrow('scope')
  expect(() =>
    selectFileWorkspace(workspace, undefined, '../home/note.txt'),
  ).toThrow('scope')
  expect(selectFileWorkspace(workspace, 'agent', 'note.txt').path).toBe(
    personal,
  )
  expect(() => selectFileWorkspace(withAgentHome(undefined, home))).toThrow(
    'scope',
  )
})

test('dynamic helpers select personal files explicitly without a project fallback', () => {
  const read = createFileHelper(undefined, undefined, personal)
  expect(() => read('note.txt', { wrap: false })).toThrow('scope')
  expect(read('note.txt', { wrap: false, scope: 'agent' })).toBe(
    'Personal note',
  )
  expect(
    read(path.join(personal, 'note.txt'), { wrap: false, scope: 'agent' }),
  ).toBe('Personal note')
  const exists = createFileExistsHelper(undefined, undefined, personal)
  expect(exists('note.txt')).toBe(false)
  expect(exists('note.txt', { scope: 'agent' })).toBe(true)
})

test('managed cleanup refuses arbitrary paths and symlink substitutions', async () => {
  const target = managedHome('owner', 'a')
  await mkdir(target, { recursive: true })
  await writeFile(path.join(target, 'custom.txt'), 'Keep until confirmed')
  await expect(
    runFileOperation({
      id: 'bad-target',
      kind: 'delete-home',
      ownerId: 'owner',
      agentId: 'a',
      homePath: personal,
    }),
  ).rejects.toThrow('managed')
  await rm(target, { recursive: true })
  await symlink(personal, target)
  await expect(
    runFileOperation({
      id: 'bad-link',
      kind: 'delete-home',
      ownerId: 'owner',
      agentId: 'a',
    }),
  ).rejects.toThrow('Symlink')
  expect(await readFile(path.join(personal, 'note.txt'), 'utf8')).toBe(
    'Personal note',
  )
  await rm(target)
  await mkdir(target)
  await runFileOperation({
    id: 'cleanup',
    kind: 'delete-home',
    ownerId: 'owner',
    agentId: 'a',
  })
  await expect(stat(target)).rejects.toThrow()
  await runFileOperation({
    id: 'cleanup',
    kind: 'delete-home',
    ownerId: 'owner',
    agentId: 'a',
  })
})

test('direct sidecar reads and previews reject home access hidden behind a project symlink', async () => {
  const { readWorkspaceFile, previewWorkspaceDiff, checkFlaggedPaths } =
    await import('@sb/sidecar/mcp/workspace/workspace')
  await symlink(personal, path.join(project, 'personal-link'))
  const workspace = withAgentHome(
    {
      workspaceId: 'scope-test',
      path: project,
      label: 'Project',
      sources: [{ id: 'project', path: project, label: 'Project' }],
    },
    {
      agentId: 'a',
      homeId: 'home-a',
      ownerId: 'owner',
      path: personal,
      revision: 0,
    },
  )
  const input = {
    sessionId: 'scope-test',
    workspaceId: 'scope-test',
    workspace,
    filePath: 'personal-link/note.txt',
    allowedPaths: [personal],
  }
  await expect(readWorkspaceFile(input)).rejects.toThrow('scope')
  expect(
    await previewWorkspaceDiff({ ...input, content: 'replacement' }),
  ).toEqual({ diff: '' })
  await expect(
    checkFlaggedPaths({ ...input, paths: [input.filePath], literal: true }),
  ).rejects.toThrow('scope')
  const selected = selectFileWorkspace(workspace, 'agent')
  expect(
    (
      await readWorkspaceFile({
        ...input,
        workspace: selected,
        filePath: 'note.txt',
      })
    ).content,
  ).toContain('Personal note')
})
