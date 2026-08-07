export type ParsedVersion = {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

const VERSION =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Keeps tags and package version comparable. */
export function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/, '')
}

export function parseVersion(value: string): ParsedVersion | null {
  const match = VERSION.exec(value.trim())
  if (!match) return null

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

/** Negative when `a` is older, `0` when equivalent. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return 0

  const release =
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch
  if (release !== 0) return Math.sign(release)

  return comparePrerelease(left.prerelease, right.prerelease)
}

/** Whether `candidate` is a release the install at `current` does not have. */
export function isNewer(current: string, candidate: string): boolean {
  if (!parseVersion(current) || !parseVersion(candidate)) return false
  return compareVersions(current, candidate) < 0
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1

  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const a = left[index]
    const b = right[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (a === b) continue

    const result = compareIdentifiers(a, b)
    if (result !== 0) return result
  }

  return 0
}

function compareIdentifiers(a: string, b: string): number {
  const numericA = /^\d+$/.test(a)
  const numericB = /^\d+$/.test(b)

  if (numericA && numericB) return Math.sign(Number(a) - Number(b))
  if (numericA) return -1
  if (numericB) return 1
  return a < b ? -1 : 1
}
