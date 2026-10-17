import type { Id } from '@sb/convex/_generated/dataModel'
import type {
  SkillVerificationPage,
  VerifySkillIdsArgs,
} from '@sb/convex/types'
import type { PaginationOptions } from 'convex/server'

type CheckPage = (args: {
  paginationOpts: PaginationOptions
}) => Promise<SkillVerificationPage>
type RemovePage = (args: VerifySkillIdsArgs) => Promise<{ removed: number }>

/** Visits every library page before returning any cleanup candidates. */
export async function checkInstalledSkills(
  checkPage: CheckPage,
  onProgress: (checked: number) => void,
) {
  let cursor: string | null = null
  let checked = 0
  let skipped = 0
  const missing: SkillVerificationPage['missing'] = []
  while (true) {
    const page = await checkPage({ paginationOpts: { cursor, numItems: 20 } })
    checked += page.checked
    skipped += page.skipped
    missing.push(...page.missing)
    onProgress(checked)
    if (page.isDone) return { checked, skipped, missing }
    cursor = page.continueCursor
  }
}

/** Sends only explicitly confirmed IDs in bounded cleanup batches. */
export async function removeConfirmedSkills(
  removePage: RemovePage,
  skillIds: Id<'skills'>[],
) {
  let removed = 0
  for (let offset = 0; offset < skillIds.length; offset += 20) {
    const result = await removePage({
      skillIds: skillIds.slice(offset, offset + 20),
    })
    removed += result.removed
  }
  return removed
}
