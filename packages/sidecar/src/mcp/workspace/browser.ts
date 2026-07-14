import { readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

import { collapseHome, expandHome } from './paths'

export const listDirectoriesSchema = z.object({
  path: z.string().optional(),
})

export type DirectoryListing = {
  path: string
  parent?: string
  entries: Array<{ name: string; path: string }>
}

export async function listDirectories(
  input: z.infer<typeof listDirectoriesSchema>,
): Promise<DirectoryListing> {
  const current = await realpath(
    path.resolve(expandHome(input.path ?? process.cwd())),
  )
  const currentStat = await stat(current)
  const root = currentStat.isDirectory() ? current : path.dirname(current)
  const parent = path.dirname(root)
  const entries = await readdir(root, { withFileTypes: true })

  return {
    path: collapseHome(root),
    parent: parent === root ? undefined : collapseHome(parent),
    entries: entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: collapseHome(path.join(root, entry.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}
