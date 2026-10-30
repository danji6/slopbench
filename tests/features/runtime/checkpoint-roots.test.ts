import { snapshot } from '@sb/sidecar/checkpoints/snapshot'
import { afterEach, describe, expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { checkpointFixture } from '~/tests/helpers/turn-checkpoints'

const execute = promisify(execFile)
const cleanup: string[] = []
afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})
const fixture = () => checkpointFixture(cleanup)

describe('checkpoint capture roots', () => {
  test('captures an agent home ignored by its enclosing project and preserves local ignores through undo/redo', async () => {
    const f = await fixture()
    await execute('git', ['init', '-q', f.root])
    await writeFile(path.join(f.root, '.gitignore'), '.data/\n')
    const home = path.join(
      f.root,
      '.data',
      'sidecar',
      'agents',
      'owner',
      'home',
    )
    await mkdir(home, { recursive: true })
    await writeFile(path.join(home, '.gitignore'), '*.log\n')
    const personal = path.join(home, 'notes.txt')
    const ignored = path.join(home, 'output.log')
    const project = path.join(f.root, 'style.css')
    await writeFile(personal, 'before home\n')
    await writeFile(ignored, 'before log\n')
    await writeFile(project, 'before project\n')
    const workspace = {
      ...f.begin.workspace,
      agentHome: {
        ownerId: 'owner',
        agentId: 'agent',
        path: home,
        revision: 0,
      },
    }
    await f.manager.begin({ ...f.begin, workspace })
    await writeFile(personal, 'after home\n')
    await writeFile(ignored, 'after log\n')
    await writeFile(project, 'after project\n')
    const result = await f.manager.finish(f.finish)
    expect(result.publication?.issues).toEqual([])
    expect(result.publication?.files.map((file) => file.path).sort()).toEqual([
      'agent://notes.txt',
      'style.css',
    ])
    await f.manager.restore({
      ...f.restore,
      workspace,
      workspaces: [workspace],
    })
    expect(await readFile(personal, 'utf8')).toBe('before home\n')
    expect(await readFile(project, 'utf8')).toBe('before project\n')
    expect(await readFile(ignored, 'utf8')).toBe('after log\n')
    await f.manager.restore({
      ...f.restore,
      workspace,
      workspaces: [workspace],
      revision: 1,
      direction: 'reapply',
      operationId: 'redo',
    })
    expect(await readFile(personal, 'utf8')).toBe('after home\n')
    expect(await readFile(project, 'utf8')).toBe('after project\n')
  })

  test('retains capture errors for a broken Git index instead of falling back to a partial filesystem scan', async () => {
    const f = await fixture()
    await execute('git', ['init', '-q', f.root])
    await writeFile(path.join(f.root, '.git', 'index'), 'broken index')
    await writeFile(path.join(f.root, 'file.txt'), 'content')
    const result = await snapshot(f.storage, [f.root])
    expect(result.issues).toHaveLength(1)
    expect(result.files).toEqual({})
  })
})
