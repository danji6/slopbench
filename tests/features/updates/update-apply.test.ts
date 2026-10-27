/// <reference types="bun-types" />
import { APP_ID } from '@sb/core/const'
import { clearReleaseCache, releaseName } from '@sb/core/update/source'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getConfig, versions } from '~/scripts/runner/config'
import { output } from '~/scripts/runner/processes'
import { applyUpdateIfRequested, rollbackUpdate } from '~/scripts/runner/update'

const CURRENT = '0.0.1'
const NEXT = '0.0.2'

let workspace: string
let install: string
let server: ReturnType<typeof Bun.serve> | undefined
const previousEnv = { ...process.env }

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), `${APP_ID}-update-`))
  install = join(workspace, 'install')
  clearReleaseCache()
})

afterEach(async () => {
  server?.stop(true)
  server = undefined
  process.env = { ...previousEnv }
  await rm(workspace, { force: true, recursive: true })
  clearReleaseCache()
})

/** An install as a downloaded release leaves it, plus local state. */
async function createInstall() {
  await mkdir(join(install, 'packages/core'), { recursive: true })
  await mkdir(join(install, '.data'), { recursive: true })
  await mkdir(join(install, 'node_modules'), { recursive: true })

  await writeFile(join(install, 'package.json'), JSON.stringify({ version: CURRENT })) // prettier-ignore
  await writeFile(join(install, 'release.json'), JSON.stringify({ version: CURRENT })) // prettier-ignore
  await writeFile(join(install, 'packages/core/old.ts'), 'export const old = 1')
  await writeFile(join(install, '.env.local'), 'SECRET=keep-me')
  await writeFile(join(install, '.data/convex.sqlite3'), 'database')
  await writeFile(join(install, 'node_modules/marker'), 'installed')
}

/** The archive a release ships: one prefixed directory holding the tree. */
async function createArchive(
  version: string,
  bunMinimum = versions.bunMinimum,
) {
  const name = releaseName(version)
  const staging = join(workspace, 'staging')
  const root = join(staging, name)
  await mkdir(join(root, 'packages/core'), { recursive: true })

  await writeFile(join(root, 'package.json'), JSON.stringify({ version }))
  await writeFile(join(root, 'release.json'), JSON.stringify({ version }))
  await writeFile(join(root, 'versions.json'), JSON.stringify({ ...versions, bunMinimum })) // prettier-ignore
  await writeFile(join(root, 'packages/core/new.ts'), 'export const fresh = 1')

  const archive = join(workspace, `${name}.tar.gz`)
  await output(['tar', '-czf', archive, name], { cwd: staging })
  return { archive, name: `${name}.tar.gz` }
}

async function serveRelease(version: string, bunMinimum?: string) {
  const { archive, name } = await createArchive(version, bunMinimum)
  const bytes = await readFile(archive)
  const digest = createHash('sha256').update(bytes).digest('hex')

  server = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url)

      if (pathname === '/feed') {
        return Response.json({
          tag_name: `v${version}`,
          body: 'Notes',
          published_at: '2026-08-10T12:00:00Z',
          html_url: 'https://example.test/release',
          assets: [
            { name, browser_download_url: `${origin()}/assets/${name}` },
            { name: 'checksums.txt', browser_download_url: `${origin()}/assets/checksums.txt` }, // prettier-ignore
          ],
        })
      }
      if (pathname === `/assets/${name}`) return new Response(bytes)
      if (pathname === '/assets/checksums.txt') {
        return new Response(`${digest}  ${name}\n`)
      }
      return new Response('not found', { status: 404 })
    },
  })

  process.env.UPDATE_FEED_URL = `${origin()}/feed`
  return { digest, name }
}

function origin() {
  return `http://127.0.0.1:${server?.port}`
}

function installConfig() {
  return {
    ...getConfig('start'),
    dataDir: join(install, '.data'),
    logDir: join(install, '.data/logs'),
    mode: 'start' as const,
    projectRoot: install,
  }
}

describe('applyUpdateIfRequested', () => {
  test('replaces the shipped tree and leaves local state alone', async () => {
    await createInstall()
    await serveRelease(NEXT)
    process.env.AUTO_UPDATE = 'true'

    const outcome = await applyUpdateIfRequested(installConfig(), {
      enabled: true,
    })

    expect(outcome).toBe('continue')
    const manifest = JSON.parse(
      await readFile(join(install, 'package.json'), 'utf8'),
    ) as { version: string }
    expect(manifest.version).toBe(NEXT)
    expect(existsSync(join(install, 'packages/core/new.ts'))).toBe(true)
    // The whole `packages` directory is replaced, not merged into.
    expect(existsSync(join(install, 'packages/core/old.ts'))).toBe(false)

    expect(await readFile(join(install, '.env.local'), 'utf8')).toBe('SECRET=keep-me') // prettier-ignore
    expect(await readFile(join(install, '.data/convex.sqlite3'), 'utf8')).toBe('database') // prettier-ignore
    expect(existsSync(join(install, 'node_modules/marker'))).toBe(true)
  })

  test('keeps a backup of the replaced tree and the database', async () => {
    await createInstall()
    await serveRelease(NEXT)
    process.env.AUTO_UPDATE = 'true'

    await applyUpdateIfRequested(installConfig(), { enabled: true })

    const backup = join(install, '.data/update/backup')
    expect(existsSync(join(backup, 'packages/core/old.ts'))).toBe(true)
    expect(await readFile(join(install, '.data/update/state/convex.sqlite3'), 'utf8')).toBe('database') // prettier-ignore

    const state = JSON.parse(
      await readFile(join(install, '.data/update/backup.json'), 'utf8'),
    ) as { version: string }
    expect(state.version).toBe(CURRENT)
  })

  // Migrations run against the new schema, so the pre-update database is the
  // only copy that can still be read by the version being restored.
  test('rollback restores the database and keeps the one it replaces', async () => {
    await createInstall()
    await serveRelease(NEXT)
    process.env.AUTO_UPDATE = 'true'

    const config = installConfig()
    await applyUpdateIfRequested(config, { enabled: true })
    await writeFile(join(install, '.data/convex.sqlite3'), 'migrated')

    await rollbackUpdate(config)

    expect(existsSync(join(install, 'packages/core/old.ts'))).toBe(true)
    expect(existsSync(join(install, 'packages/core/new.ts'))).toBe(false)
    expect(await readFile(join(install, '.data/convex.sqlite3'), 'utf8')).toBe('database') // prettier-ignore
    expect(await readFile(join(install, '.data/update/replaced/convex.sqlite3'), 'utf8')).toBe('migrated') // prettier-ignore
  })

  // A process cannot swap its own interpreter, so the swapped tree is left in
  // place and the bootstrap is given the next launch to install the new floor.
  test('asks for a relaunch when the new tree needs a newer Bun', async () => {
    await createInstall()
    await serveRelease(NEXT, '99.0.0')
    process.env.AUTO_UPDATE = 'true'

    const outcome = await applyUpdateIfRequested(installConfig(), {
      enabled: true,
    })

    expect(outcome).toBe('relaunch')
    expect(existsSync(join(install, 'packages/core/new.ts'))).toBe(true)
  })

  // The floor is read from the tree that just landed, not the one that ran.
  test('carries on when the new tree keeps the current floor', async () => {
    await createInstall()
    await serveRelease(NEXT, '0.1.0')
    process.env.AUTO_UPDATE = 'true'

    const outcome = await applyUpdateIfRequested(installConfig(), {
      enabled: true,
    })

    expect(outcome).toBe('continue')
  })

  test('does nothing when the release is not newer', async () => {
    await createInstall()
    await serveRelease(CURRENT)
    process.env.AUTO_UPDATE = 'true'

    await applyUpdateIfRequested(installConfig(), { enabled: true })

    expect(existsSync(join(install, 'packages/core/old.ts'))).toBe(true)
    expect(existsSync(join(install, '.data/update'))).toBe(false)
  })

  // A checkout would lose the user's own work if its tree were swapped.
  test('never touches a git checkout', async () => {
    await createInstall()
    await mkdir(join(install, '.git'), { recursive: true })
    await serveRelease(NEXT)
    process.env.AUTO_UPDATE = 'true'

    await applyUpdateIfRequested(installConfig(), { enabled: true })

    expect(existsSync(join(install, 'packages/core/old.ts'))).toBe(true)
    expect(existsSync(join(install, '.data/update'))).toBe(false)
  })

  test('leaves the install intact when the checksum does not match', async () => {
    await createInstall()
    const { name } = await serveRelease(NEXT)
    process.env.AUTO_UPDATE = 'true'

    const real = server
    server = Bun.serve({
      port: 0,
      async fetch(request) {
        const { pathname } = new URL(request.url)
        if (pathname === '/assets/checksums.txt') {
          return new Response(`${'0'.repeat(64)}  ${name}\n`)
        }
        return real!.fetch(request)
      },
    })
    process.env.UPDATE_FEED_URL = `${origin()}/feed`
    clearReleaseCache()

    await applyUpdateIfRequested(installConfig(), { enabled: true })

    expect(existsSync(join(install, 'packages/core/old.ts'))).toBe(true)
    expect(existsSync(join(install, 'packages/core/new.ts'))).toBe(false)
    const manifest = JSON.parse(
      await readFile(join(install, 'package.json'), 'utf8'),
    ) as { version: string }
    expect(manifest.version).toBe(CURRENT)

    real?.stop(true)
  })

  test('does nothing when updates are disabled', async () => {
    await createInstall()
    await serveRelease(NEXT)

    await applyUpdateIfRequested(installConfig(), { enabled: false })

    expect(existsSync(join(install, 'packages/core/old.ts'))).toBe(true)
  })
})
