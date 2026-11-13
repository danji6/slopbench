import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getConfig, projectRoot } from '~/scripts/runner/config'
import { ProcessManager, bun, output } from '~/scripts/runner/processes'
import { startSidecar } from '~/scripts/runner/sidecar'
import { resolveNodeBinary, sidecarBuildEntry } from '~/scripts/sidecar'

let root: string
let manager: ProcessManager

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'corvori-sidecar-startup-'))
  await createFixture()
  manager = new ProcessManager({
    cwd: root,
    env: { ...process.env, SIDECAR_SECRET: '' },
    filterLogs: false,
    logDir: join(root, 'logs'),
    mode: 'start',
  })
})

afterEach(async () => {
  await manager?.stopAll()
  await rm(root, { recursive: true, force: true })
})

async function createFixture() {
  const files = [
    'scripts/sidecar.ts',
    'scripts/runner/config.ts',
    'versions.json',
  ]
  for (const file of files) {
    const target = join(root, file)
    await mkdir(join(target, '..'), { recursive: true })
    await copyFile(join(projectRoot, file), target)
  }

  for (const file of ['eval/worker.ts', 'mcp/external/stdio-supervisor.ts']) {
    const target = join(root, 'packages/sidecar/src', file)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, 'export const fixture = true')
  }
}

function config() {
  return {
    ...getConfig('start'),
    dataDir: join(root, 'custom data'),
    nodeBinary: resolveNodeBinary(),
    projectRoot: root,
    sidecarDataDir: root,
    sidecarSecret: 'startup-fixture',
  }
}

test('builds and starts under Node after dependencies appear in a child process', async () => {
  const entry = join(root, 'packages/sidecar/src/main.ts')
  await writeFile(
    entry,
    `import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { value } from 'corvori-startup-fixture-dependency'
writeFileSync(join(process.env.CHAT_SIDECAR_DATA_DIR, 'started.json'), JSON.stringify({
  value,
  node: !process.versions.bun,
  authenticated: process.env.SIDECAR_SECRET === 'startup-fixture',
}))`,
  )

  // Prime the launcher's resolver before simulating an install in another process.
  const missing = await Bun.build({
    entrypoints: [entry],
    target: 'node',
    throw: false,
  })
  expect(missing.success).toBe(false)
  await output(
    bun(
      '--no-env-file',
      '-e',
      `await Bun.write('node_modules/corvori-startup-fixture-dependency/package.json',
        JSON.stringify({ name: 'corvori-startup-fixture-dependency', main: 'index.js' }))
      await Bun.write('node_modules/corvori-startup-fixture-dependency/index.js',
        'export const value = 42')`,
    ),
    { cwd: root },
  )

  const child = await startSidecar(manager, config())
  expect(await child.exited).toBe(0)
  expect(
    JSON.parse(await readFile(join(root, 'started.json'), 'utf8')),
  ).toEqual({
    value: 42,
    node: true,
    authenticated: true,
  })
  for (const name of ['main.js', 'worker.js', 'stdio-supervisor.js']) {
    expect(existsSync(join(config().dataDir, 'build/sidecar', name))).toBe(true)
  }
})

test('rejects a failed build without starting an existing stale bundle', async () => {
  await writeFile(
    join(root, 'packages/sidecar/src/main.ts'),
    "import 'corvori-startup-missing-dependency'",
  )
  const staleEntry = sidecarBuildEntry(config().dataDir)
  await mkdir(join(staleEntry, '..'), { recursive: true })
  await writeFile(
    staleEntry,
    `require('node:fs').writeFileSync(${JSON.stringify(join(root, 'started.json'))}, '{}')`,
  )

  await expect(startSidecar(manager, config())).rejects.toThrow(
    'sidecar-build exited with code 1',
  )
  expect(existsSync(join(root, 'started.json'))).toBe(false)
})
