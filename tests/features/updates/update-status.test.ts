/// <reference types="bun-types" />
import { APP_ID } from '@sb/core/const'
import { readInstall } from '@sb/sidecar/update/status'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))) // prettier-ignore
})

async function createRoot(files: {
  git?: boolean
  packageJson?: string
  release?: string
}) {
  const root = await mkdtemp(join(tmpdir(), `${APP_ID}-install-`))
  roots.push(root)

  if (files.packageJson) {
    await writeFile(join(root, 'package.json'), files.packageJson)
  }
  if (files.release) {
    await writeFile(join(root, 'release.json'), files.release)
  }
  if (files.git) await mkdir(join(root, '.git'))

  return root
}

describe('readInstall', () => {
  test('reads a released install from its release.json', async () => {
    const root = await createRoot({
      packageJson: JSON.stringify({ version: '0.3.0' }),
      release: JSON.stringify({ version: '0.3.0', commit: 'abc1234' }),
    })

    expect(await readInstall(root)).toEqual({
      commit: 'abc1234',
      kind: 'released',
      updatable: true,
      version: '0.3.0',
    })
  })

  test('detects a git checkout by its .git directory', async () => {
    const root = await createRoot({
      git: true,
      packageJson: JSON.stringify({ version: '0.3.0' }),
      release: JSON.stringify({ version: '0.3.0' }),
    })

    const install = await readInstall(root)
    expect(install.kind).toBe('git-checkout')
    expect(install.updatable).toBe(false)
  })

  test('reports a source tree with no manifests at all', async () => {
    const install = await readInstall(await createRoot({}))

    expect(install.kind).toBe('source-checkout')
    expect(install.updatable).toBe(false)
    expect(install.version).toBe('0.0.0')
  })
})
