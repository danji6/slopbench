import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { z } from 'zod'

import type { verifyLibrarySchema } from './schemas'
import { assertPlainPath, identifier, isMissing, libraryRoot } from './storage'

/** Reports only absent bundles as missing; access and filesystem errors abort the check. */
export async function verifyLibrary(
  input: z.infer<typeof verifyLibrarySchema>,
) {
  const missing: string[] = []
  for (const skill of input.skills) {
    const root = libraryRoot(input.ownerId, skill.skillId)
    const filename = path.join(root, identifier(skill.name), 'SKILL.md')
    await assertPlainPath(filename)
    try {
      if (!(await stat(filename)).isFile())
        throw new Error('SKILL.md must be a regular file')
    } catch (error) {
      if (!isMissing(error)) throw error
      missing.push(skill.skillId)
    }
  }
  return { missing }
}
