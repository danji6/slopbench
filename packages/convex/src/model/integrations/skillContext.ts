import { sha256 } from '@sb/core/sha256'

import type { Doc } from '../../_generated/dataModel'

type SkillIntegration = Pick<
  Doc<'integrations'>,
  '_id' | 'root' | 'name' | 'revision' | 'skillsEnabled' | 'disabledSkills'
>

/** Identifies only the effective integration contributions to this execution's catalog. */
export function integrationSkillFingerprint(rows: SkillIntegration[]) {
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
  rows: SkillIntegration[],
) {
  const fingerprint = await integrationSkillFingerprint(rows)
  return {
    ...stream,
    skillContextPrepared:
      !!stream.skillContextPrepared &&
      stream.skillIntegrationFingerprint === fingerprint,
  }
}
