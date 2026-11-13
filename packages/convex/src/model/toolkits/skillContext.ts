import { sha256 } from '@cv/core/sha256'

import type { Doc } from '../../_generated/dataModel'

type SkillToolkit = Pick<
  Doc<'toolkits'>,
  '_id' | 'root' | 'name' | 'revision' | 'skillsEnabled' | 'disabledSkills'
>

/** Identifies only the effective toolkit contributions to this execution's catalog. */
export function toolkitSkillFingerprint(rows: SkillToolkit[]) {
  const contributions = rows
    .filter((row) => row.skillsEnabled)
    .map((row) => ({
      id: row._id,
      root: row.root,
      name: row.name,
      revision: row.revision,
      disabledSkills: [...row.disabledSkills].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
  return sha256(JSON.stringify(contributions))
}

/** Revalidates lazily at a provider boundary, without touching other executions or history. */
export async function withCurrentSkillContext<T extends Doc<'streams'>>(
  stream: T,
  rows: SkillToolkit[],
) {
  const fingerprint = await toolkitSkillFingerprint(rows)
  return {
    ...stream,
    skillContextPrepared:
      !!stream.skillContextPrepared &&
      stream.skillToolkitFingerprint === fingerprint,
  }
}
