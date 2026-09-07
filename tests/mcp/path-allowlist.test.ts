import {
  canonicalPath,
  resolveToolPath,
} from '@sb/sidecar/mcp/workspace/access'
import { checkPaths } from '@sb/sidecar/mcp/workspace/check-paths'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

let base: string
let root: string
let external: string

describe('sidecar path resolution', () => {
  beforeAll(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'path-policy-'))
    root = path.join(base, 'workspace')
    external = path.join(base, 'external')
    await mkdir(path.join(root, 'src'), { recursive: true })
    await mkdir(path.join(external, 'nested'), { recursive: true })
    await Bun.$`git init -q ${root}`.quiet()
    await writeFile(path.join(root, '.gitignore'), 'ignored/\nalias.txt\n')
    await mkdir(path.join(root, 'ignored'))
    await writeFile(path.join(root, 'ignored', 'file.txt'), 'fixture')
    await writeFile(path.join(root, 'src', 'file.txt'), 'fixture')
    await writeFile(path.join(external, 'file.txt'), 'outside')
    await symlink(external, path.join(root, 'src', 'escape'))
    await symlink(path.join(root, '.git'), path.join(root, 'git-alias'))
    await symlink(
      path.join(root, 'src', 'file.txt'),
      path.join(root, 'alias.txt'),
    )
    await symlink(
      path.join(external, 'nested'),
      path.join(root, 'nested-alias'),
    )
    await symlink(path.join(external, 'missing'), path.join(root, 'dangling'))
  })
  afterAll(async () => {
    await rm(base, { recursive: true, force: true })
  })

  test('relative and absolute grants agree, including new files', async () => {
    for (const grant of ['src/', path.join(root, 'src')]) {
      const result = await checkPaths(root, {
        paths: ['./src/file.txt', path.join(root, 'src', 'new', 'file')],
        allowedPaths: [grant],
        literal: true,
      })
      expect(result.complete).toBe(true)
      expect(result.resolved.every((item) => item.allowed)).toBe(true)
    }
    const other = await checkPaths(external, {
      paths: ['src/new'],
      allowedPaths: ['src'],
      literal: true,
    })
    expect(other.resolved[0]?.absolutePath).toBe(path.join(external, 'src/new'))
    expect(other.resolved[0]?.allowed).toBe(true)
  })

  test('parent-relative grants match sibling files and new descendants', async () => {
    for (const grant of ['../external', external]) {
      const result = await checkPaths(root, {
        paths: [
          '../external/file.txt',
          '../external/new/file',
          '../external-cache/file',
        ],
        allowedPaths: [grant],
        literal: true,
      })
      expect(result.complete).toBe(true)
      expect(result.resolved.map((item) => item.allowed)).toEqual([
        true,
        true,
        false,
      ])
      const target = await resolveToolPath(root, '../external/new/file', [
        grant,
      ])
      expect(target.relativePath).toBe(path.join(external, 'new/file'))
      expect(target.external).toBe(true)
    }
  })

  test('parent-relative grants follow workspace rebinds while absolute grants stay fixed', async () => {
    const rebound = path.join(base, 'rebound', 'workspace')
    await mkdir(rebound, { recursive: true })
    const sibling = path.join(base, 'rebound', 'external', 'new')
    expect(
      (await resolveToolPath(root, '../external/new', ['../external']))
        .relativePath,
    ).toBe(path.join(external, 'new'))
    expect(
      (await resolveToolPath(rebound, '../external/new', ['../external']))
        .relativePath,
    ).toBe(sibling)
    await expect(resolveToolPath(rebound, sibling, [external])).rejects.toThrow(
      'escapes',
    )
    expect(
      (await resolveToolPath(rebound, path.join(external, 'new'), [external]))
        .relativePath,
    ).toBe(path.join(external, 'new'))
  })

  test('parent-relative grants preserve symlink and explicit .git boundaries', async () => {
    await symlink(root, path.join(external, 'escape'))
    const result = await checkPaths(root, {
      paths: ['../external/escape/src/file.txt', '../external/.git/config'],
      allowedPaths: ['../external'],
      literal: true,
    })
    expect(result.resolved.map((item) => item.allowed)).toEqual([false, false])
    const explicit = await checkPaths(root, {
      paths: ['../external/.git/config'],
      allowedPaths: ['../external', '../external/.git'],
      literal: true,
    })
    expect(explicit.resolved[0]?.allowed).toBe(true)
  })

  test('requires external grants and prevents symlink escapes', async () => {
    await expect(
      resolveToolPath(root, 'src/escape/file.txt', ['src']),
    ).rejects.toThrow('escapes')
    await expect(
      resolveToolPath(root, path.join(external, 'new'), ['.']),
    ).rejects.toThrow('escapes')
    const allowed = await resolveToolPath(root, 'src/escape/file.txt', [
      external,
    ])
    expect(allowed.relativePath).toBe(path.join(external, 'file.txt'))
    expect(allowed.external).toBe(true)
    const result = await checkPaths(root, {
      paths: ['src/escape/file.txt'],
      allowedPaths: ['src'],
    })
    expect(result.uncovered).toEqual([path.join(external, 'file.txt')])
  })

  test('resolves symlinks before .. and fails closed for dangling links', async () => {
    expect(await canonicalPath(`${root}/nested-alias/../file.txt`)).toBe(
      path.join(external, 'file.txt'),
    )
    const result = await checkPaths(root, {
      paths: ['dangling'],
      allowedPaths: ['.'],
      literal: true,
    })
    expect(result.complete).toBe(false)
    expect(result.uncovered).toEqual(['dangling'])
  })

  test('protects .git through aliases and broad grants', async () => {
    for (const grant of ['.', root, 'git-alias']) {
      const result = await checkPaths(root, {
        paths: ['git-alias/config'],
        allowedPaths: [grant],
        literal: true,
      })
      expect(result.resolved[0]?.allowed).toBe(false)
      expect(result.resolved[0]?.forbidden).toBe(true)
    }
    const result = await checkPaths(root, {
      paths: ['.git/config', 'git-alias/config'],
      allowedPaths: ['.git'],
    })
    expect(result.uncovered).toEqual([])
  })

  test('retains ignored-path metadata while covering grants', async () => {
    const result = await checkPaths(root, {
      paths: ['ignored/*.txt'],
      allowedPaths: [path.join(root, 'ignored')],
    })
    expect(result.complete).toBe(true)
    expect(result.flagged).toEqual(['ignored/file.txt'])
    expect(result.uncovered).toEqual([])
    const alias = await checkPaths(root, { paths: ['alias.txt'] })
    expect(alias.uncovered).toEqual(['src/file.txt'])
    const dynamic = await checkPaths(root, {
      paths: ['$HOME/file', '~/file'],
      allowedPaths: ['/'],
    })
    expect(dynamic.complete).toBe(false)
    expect(dynamic.uncovered).toHaveLength(2)
  })

  test('grant patterns stay literal and glob overflow is incomplete', async () => {
    const result = await checkPaths(root, {
      paths: ['ignored/file.txt'],
      allowedPaths: ['ignored/*'],
    })
    expect(result.uncovered).toEqual(['ignored/file.txt'])
    await mkdir(path.join(root, 'many'))
    await Promise.all(
      Array.from({ length: 257 }, (_, i) =>
        writeFile(path.join(root, 'many', `${i}.txt`), ''),
      ),
    )
    expect(
      (await checkPaths(root, { paths: ['many/*'], allowedPaths: ['.'] }))
        .complete,
    ).toBe(false)
  })
})
