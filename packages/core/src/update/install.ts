export type InstallKind = 'released' | 'git-checkout' | 'source-checkout'

export type InstallInfo = {
  version: string
  commit?: string
  kind: InstallKind
  /** Whether this install may replace itself in place. */
  updatable: boolean
}

export type InstallFiles = {
  /** Contents of `release.json`, written into release artifacts by CI. */
  release?: string | null
  packageJson?: string | null
  hasGit: boolean
}

const UNKNOWN_VERSION = '0.0.0'

/**
 * Decides what kind of install this is from what is on disk and whether it can
 * self-update.
 */
export function resolveInstall(files: InstallFiles): InstallInfo {
  const release = parseJson(files.release)
  const pkg = parseJson(files.packageJson)
  const version = string(release?.version) ?? string(pkg?.version) ?? UNKNOWN_VERSION // prettier-ignore
  const commit = string(release?.commit)

  if (files.hasGit) return { version, commit, kind: 'git-checkout', updatable: false } // prettier-ignore
  if (!release) return { version, kind: 'source-checkout', updatable: false }

  return { version, commit, kind: 'released', updatable: true }
}

/** Why an install cannot update itself, for the UI and the runner logs. */
export function installBlockReason(kind: InstallKind): string | undefined {
  switch (kind) {
    case 'git-checkout':
      return 'This is a git checkout. Run `git pull` to update.'
    case 'source-checkout':
      return 'This install did not come from a release, so it cannot self-update.'
    default:
      return undefined
  }
}

function parseJson(value: string | null | undefined) {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}
