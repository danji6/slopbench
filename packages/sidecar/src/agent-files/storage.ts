import { createReadStream, createWriteStream, realpathSync } from 'node:fs'
import { chmod, lstat, mkdir, opendir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import { expandHome } from '../mcp/workspace/paths'

let canonicalData: { requested: string; path: string } | undefined

export function dataRoot() {
  const root = process.env.CHAT_SIDECAR_DATA_DIR
  if (!root) throw new Error('Sidecar data directory must be set')

  const requested = path.resolve(expandHome(root))
  if (canonicalData?.requested === requested) return canonicalData.path

  let existing = requested
  const missing: string[] = []
  while (true) {
    try {
      const resolved = path.join(realpathSync(existing), ...missing.reverse())
      canonicalData = { requested, path: resolved }
      return resolved
    } catch (error) {
      if (!isMissing(error) || path.dirname(existing) === existing) throw error
      missing.push(path.basename(existing))
      existing = path.dirname(existing)
    }
  }
}

export function identifier(value: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value))
    throw new Error('Invalid storage identity')
  return value
}

export function managedHome(ownerId: string, agentId: string) {
  return path.join(
    dataRoot(),
    'agents',
    identifier(ownerId),
    identifier(agentId),
  )
}

export function libraryRoot(ownerId: string, skillId: string) {
  return path.join(
    dataRoot(),
    'skills',
    identifier(ownerId),
    identifier(skillId),
  )
}

export function operationRoot(id: string) {
  return path.join(dataRoot(), 'agent-operations', identifier(id))
}

export function inside(root: string, target: string) {
  const relative = path.relative(root, target)
  return (
    !path.isAbsolute(relative) &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`)
  )
}

/** Reject symlink substitutions, including those in a destination's ancestors. */
export async function assertPlainPath(target: string) {
  let current = path.parse(path.resolve(target)).root
  const parts = path.resolve(target).slice(current.length).split(path.sep)
  for (const part of parts) {
    current = path.join(current, part)
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error(`Symlink is not supported: ${current}`)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }
}

export function isMissing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export async function resolveHome(
  ownerId: string,
  agentId: string,
  override?: string,
  selecting = false,
) {
  const requested = override
    ? path.resolve(expandHome(override))
    : managedHome(ownerId, agentId)

  if (!override) {
    await assertPlainPath(requested)
    await mkdir(requested, { recursive: true })
  }
  if (override && !selecting) await assertPlainPath(requested)

  const root = await realpath(requested)
  await assertPlainPath(root)
  if (!(await stat(root)).isDirectory())
    throw new Error('Personal home must be a directory')

  const insideData =
    override &&
    inside(dataRoot(), root) &&
    root !== managedHome(ownerId, agentId)
  if (insideData) throw new Error('Custom homes cannot overlap sidecar storage')

  return root
}

/** Copies one entry at a time, with bounded memory and no replacement of targets. */
export async function copyTree(source: string, target: string) {
  if (inside(path.resolve(source), path.resolve(target)))
    throw new Error('Copy destination must not be inside its source directory')

  await assertPlainPath(source)
  await assertPlainPath(target)

  const info = await lstat(source)
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true })
    for await (const entry of await opendir(source)) {
      await copyTree(
        path.join(source, entry.name),
        path.join(target, entry.name),
      )
    }
    await chmod(target, (info.mode & 0o777) | 0o700)
  } else if (info.isFile()) {
    await mkdir(path.dirname(target), { recursive: true })
    await pipeline(
      createReadStream(source),
      createWriteStream(target, {
        flags: 'wx',
        mode: (info.mode & 0o777) | 0o600,
      }),
    )
  } else {
    throw new Error(
      `Only regular files and directories can be copied: ${source}`,
    )
  }
}
