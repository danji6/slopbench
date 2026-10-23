export const SKILL_NAME_SOURCE = '[a-z0-9]+(?:-[a-z0-9]+)*'
export const SKILL_NAME_PATTERN = new RegExp(`^${SKILL_NAME_SOURCE}$`)
export const MAX_SKILL_NAME_LENGTH = 64

/** Checks the shared skill directory and frontmatter name policy. */
export function isSkillName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_SKILL_NAME_LENGTH &&
    SKILL_NAME_PATTERN.test(value)
  )
}

/** Updates one skill selection while retaining the remaining disabled skills. */
export function updateDisabledSkills(
  disabledSkills: string[],
  name: string,
  enabled: boolean,
) {
  const disabled = new Set(disabledSkills)
  if (enabled) disabled.delete(name)
  else disabled.add(name)
  return [...disabled]
}
