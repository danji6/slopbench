import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import type { RunnerConfig } from './config'
import type { ProcessManager } from './processes'

const cacheVersion = 1

const inputFiles = [
  'bun.lock',
  'convex.json',
  'package.json',
  'tsconfig.json',
  'packages/client/index.html',
  'packages/client/package.json',
  'packages/client/tsconfig.json',
  'packages/client/vite.config.ts',
  'packages/convex/package.json',
  'packages/core/package.json',
  'packages/core/tsconfig.json',
]

const inputDirectories = [
  'packages/client/public',
  'packages/client/src',
  'packages/convex/src',
  'packages/core/src',
]

const ignoredDirectoryNames = new Set([
  '.git',
  '_deps',
  'dist',
  'node_modules',
  'tmp',
])

const includedExtensions = new Set([
  '.css',
  '.d.ts',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.ts',
  '.tsx',
  '.wasm',
])

export async function buildFrontendIfNeeded(
  manager: ProcessManager,
  config: RunnerConfig,
  options: { force: boolean },
) {
  const cachePath = join(config.dataDir, 'runner/frontend-build.json')
  const fingerprint = await createFrontendFingerprint(config)

  if (
    !options.force &&
    (await isBuildFresh(
      join(config.frontendDist, 'index.html'),
      cachePath,
      fingerprint,
    ))
  ) {
    console.log('Frontend build unchanged; reusing existing client dist/.')
    return
  }

  await manager.run('frontend-build', ['bun', 'run', 'build'], {
    cwd: config.clientRoot,
  })
  await writeBuildCache(cachePath, fingerprint)
}

async function isBuildFresh(
  distIndexPath: string,
  cachePath: string,
  fingerprint: string,
) {
  if (!existsSync(distIndexPath) || !existsSync(cachePath)) return false

  try {
    const cache = JSON.parse(await readFile(cachePath, 'utf8')) as {
      fingerprint?: string
      version?: number
    }
    return cache.version === cacheVersion && cache.fingerprint === fingerprint
  } catch {
    return false
  }
}

async function writeBuildCache(cachePath: string, fingerprint: string) {
  await mkdir(dirname(cachePath), { recursive: true })
  await writeFile(
    cachePath,
    `${JSON.stringify({ fingerprint, version: cacheVersion }, null, 2)}\n`,
  )
}

async function createFrontendFingerprint(config: RunnerConfig) {
  const hash = createHash('sha256')
  hash.update(`version:${cacheVersion}\n`)
  hash.update(JSON.stringify(frontendEnvironment()))

  for (const file of await frontendInputPaths(config.projectRoot)) {
    const contents = await readFile(file)
    hash.update(relative(config.projectRoot, file))
    hash.update('\0')
    hash.update(contents)
    hash.update('\0')
  }

  return hash.digest('hex')
}

function frontendEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env)
      .filter(([key]) => key === 'NODE_ENV' || key.startsWith('VITE_'))
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

async function frontendInputPaths(root: string) {
  const paths = new Set<string>()

  for (const file of inputFiles) {
    const path = join(root, file)
    if (existsSync(path)) paths.add(path)
  }

  for (const directory of inputDirectories) {
    const path = join(root, directory)
    if (existsSync(path)) {
      for (const file of await filesInDirectory(path)) {
        paths.add(file)
      }
    }
  }

  return [...paths].sort()
}

async function filesInDirectory(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!ignoredDirectoryNames.has(entry.name)) {
        files.push(...(await filesInDirectory(path)))
      }
    } else if (entry.isFile() && (await shouldIncludeFile(path))) {
      files.push(path)
    }
  }

  return files
}

async function shouldIncludeFile(path: string) {
  if (includedExtensions.has(extension(path))) return true

  const stats = await stat(path)
  return stats.size > 0 && stats.size < 1024 * 1024
}

function extension(path: string) {
  const basename = path.slice(path.lastIndexOf('/') + 1)
  const dtsSuffix = '.d.ts'
  if (basename.endsWith(dtsSuffix)) return dtsSuffix

  const index = basename.lastIndexOf('.')
  return index === -1 ? '' : basename.slice(index)
}
