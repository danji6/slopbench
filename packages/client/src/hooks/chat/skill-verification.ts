import {
  checkInstalledSkills,
  removeConfirmedSkills,
} from '@/lib/chat/skill-verification'
import { extractErrorMessage } from '@/lib/errors'
import { api } from '@sb/convex/_generated/api'
import { useAction } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { useState } from 'react'

type MissingSkill = FunctionReturnType<
  typeof api.actions.skills.checkLibraryPage
>['missing'][number]

/** Scans every library page and removes only the candidates the user confirmed. */
export function useSkillVerification() {
  const checkPage = useAction(api.actions.skills.checkLibraryPage)
  const removeMissing = useAction(api.actions.skills.removeMissingSkills)
  const [phase, setPhase] = useState<'checking' | 'removing'>()
  const [missing, setMissing] = useState<MissingSkill[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string>()

  async function check() {
    if (phase) return
    setPhase('checking')
    setError(undefined)
    setMissing([])
    try {
      const { checked, skipped, missing } = await checkInstalledSkills(
        checkPage,
        (checked) => setMessage(`Checked ${checked} skills…`),
      )
      setMissing(missing)
      const result = missing.length
        ? `${missing.length} skills have missing data.`
        : 'All checked skills are available.'
      const busy = skipped
        ? ` ${skipped} busy skills were skipped; check again when their operations finish.`
        : ''
      setMessage(`Checked ${checked} skills. ${result}${busy}`)
    } catch (error) {
      setMessage('The check could not finish. No skills were removed.')
      setError(extractErrorMessage(error))
    } finally {
      setPhase(undefined)
    }
  }

  async function remove() {
    if (phase || !missing.length) return
    setPhase('removing')
    setError(undefined)
    const confirmed = missing
    setMissing([])
    try {
      const removed = await removeConfirmedSkills(
        removeMissing,
        confirmed.map((skill) => skill.skillId),
      )
      setMessage(
        `Removed ${removed} missing skills. ${confirmed.length - removed} entries were retained after rechecking.`,
      )
    } catch (error) {
      setMessage(
        'Cleanup stopped. Some entries may have been removed. Check again to review the remaining entries.',
      )
      setError(extractErrorMessage(error))
    } finally {
      setPhase(undefined)
    }
  }

  return {
    check,
    remove,
    phase,
    missing,
    message,
    error,
    dismiss: () => setMissing([]),
  }
}
