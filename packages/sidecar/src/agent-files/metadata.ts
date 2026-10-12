import { SKILL_HEADER_READ_BYTES } from '@sb/core/skills/types'
import type { SkillMetadata } from '@sb/core/skills/types'
import { open } from 'node:fs/promises'
import path from 'node:path'

import { skillFrontmatter } from './frontmatter'
import { assertPlainPath } from './storage'

/** Reads only the bounded frontmatter prefix, irrespective of the skill's body size. */
export async function readSkillMetadata(root: string): Promise<SkillMetadata> {
  const filename = path.join(root, 'SKILL.md')
  await assertPlainPath(filename)
  const file = await open(filename, 'r')
  try {
    if (!(await file.stat()).isFile())
      throw new Error('SKILL.md must be a regular file')
    const buffer = Buffer.alloc(SKILL_HEADER_READ_BYTES)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    return parseSkillMetadata(buffer.subarray(0, bytesRead).toString('utf8'))
  } finally {
    await file.close()
  }
}

export function parseSkillMetadata(text: string): SkillMetadata {
  const header = text
    .replace(/^\uFEFF/, '')
    .match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!header) {
    throw new Error(
      'SKILL.md requires YAML frontmatter within the metadata read budget',
    )
  }

  const document = skillFrontmatter(header[1])
  if (document.errors.length) throw new Error('Invalid skill YAML frontmatter')

  const metadata = document.toJS({ maxAliasCount: 0 }) as Record<string, unknown> | null // prettier-ignore
  const name = metadata?.name
  const description = metadata?.description
  if (
    typeof name !== 'string' ||
    name.length > 64 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
  ) {
    throw new Error(
      'Skill name must use lowercase letters, numbers and single hyphens (maximum 64 characters)',
    )
  }

  if (
    typeof description !== 'string' ||
    !description.trim() ||
    [...description].length > 1024
  ) {
    throw new Error('Skill description must contain 1–1024 characters')
  }

  return { name, description }
}
