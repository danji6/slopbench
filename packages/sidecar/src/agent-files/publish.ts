import { lstat, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { assertPlainPath, isMissing } from './storage'

type PublishIntent = {
  target: string
  device: string
  inode: string
  result: unknown
}

/** Recovers the rename/acknowledgement gap without overwriting an existing skill copy. */
export async function recoverDirectoryPublish(
  operation: string,
): Promise<{ result: unknown } | null> {
  let intent: PublishIntent
  try {
    intent = JSON.parse(
      await readFile(path.join(operation, 'publish-intent.json'), 'utf8'),
    ) as PublishIntent
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }

  await assertPlainPath(intent.target)

  let target
  try {
    target = await lstat(intent.target, { bigint: true })
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }

  if (
    target.dev.toString() !== intent.device ||
    target.ino.toString() !== intent.inode
  ) {
    throw new Error('Destination conflicts with interrupted filesystem work')
  }

  return { result: intent.result }
}

/** Persists a directory's identity before making its files available atomically. */
export async function publishDirectory(
  source: string,
  target: string,
  operation: string,
  result: unknown,
) {
  await assertPlainPath(target)

  try {
    await lstat(target)
    throw new Error(`Destination already exists: ${target}`)
  } catch (error) {
    if (!isMissing(error)) throw error
  }

  const info = await lstat(source, { bigint: true })
  const intent: PublishIntent = {
    target,
    device: info.dev.toString(),
    inode: info.ino.toString(),
    result,
  }

  await writeFile(
    path.join(operation, 'publish-intent.tmp'),
    JSON.stringify(intent),
  )
  await rename(
    path.join(operation, 'publish-intent.tmp'),
    path.join(operation, 'publish-intent.json'),
  )
  await rename(source, target)
}
