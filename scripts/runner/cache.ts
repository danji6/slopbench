import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

export type FingerprintInputs = {
  /** Extra values folded into the hash, e.g. relevant environment. */
  extra?: unknown
  files: string[]
  directories?: string[]
  ignoredDirectoryNames?: Set<string>
  includedExtensions?: Set<string>
}

/** Whether a cache file records this exact fingerprint. */
export async function isCacheFresh(
  cachePath: string,
  fingerprint: string,
  version: number,
) {
  if (!existsSync(cachePath)) return false

  try {
    const cache = JSON.parse(await readFile(cachePath, 'utf8')) as {
      fingerprint?: string
      version?: number
    }
    return cache.version === version && cache.fingerprint === fingerprint
  } catch {
    return false
  }
}

export async function writeCacheState(
  cachePath: string,
  fingerprint: string,
  version: number,
) {
  await mkdir(dirname(cachePath), { recursive: true })
  await writeFile(
    cachePath,
    `${JSON.stringify({ fingerprint, version }, null, 2)}\n`,
  )
}

/** Forces the next run to redo the cached work. */
export async function invalidateCache(cachePath: string) {
  await rm(cachePath, { force: true })
}

/** Hashes a set of files and directory trees, relative to `root`. */
export async function createFingerprint(
  root: string,
  inputs: FingerprintInputs,
  version: number,
) {
  const hash = createHash('sha256')
  hash.update(`version:${version}\n`)
  if (inputs.extra !== undefined) hash.update(JSON.stringify(inputs.extra))

  for (const file of await inputPaths(root, inputs)) {
    hash.update(relative(root, file))
    hash.update('\0')
    hash.update(await readFile(file))
    hash.update('\0')
  }

  return hash.digest('hex')
}

async function inputPaths(root: string, inputs: FingerprintInputs) {
  const paths = new Set<string>()

  for (const file of inputs.files) {
    const path = join(root, file)
    if (existsSync(path)) paths.add(path)
  }

  for (const directory of inputs.directories ?? []) {
    const path = join(root, directory)
    if (!existsSync(path)) continue

    for (const file of await filesInDirectory(path, inputs)) {
      paths.add(file)
    }
  }

  return [...paths].sort()
}

async function filesInDirectory(
  directory: string,
  inputs: FingerprintInputs,
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!inputs.ignoredDirectoryNames?.has(entry.name)) {
        files.push(...(await filesInDirectory(path, inputs)))
      }
    } else if (entry.isFile() && (await shouldIncludeFile(path, inputs))) {
      files.push(path)
    }
  }

  return files
}

async function shouldIncludeFile(path: string, inputs: FingerprintInputs) {
  if (!inputs.includedExtensions) return true
  if (inputs.includedExtensions.has(extension(path))) return true

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
