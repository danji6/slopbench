import { compareVersions, parseVersion } from '@sb/core/update/version'

import { type RunnerConfig, readVersions } from './config'

export type BunShortfall = { minimum: string; running: string }

/** Drops the pre-release suffix, matching what the bootstrap compares on. */
function release(version: string) {
  return version.split(/[-+]/)[0]
}

/** Whether the `running` Bun is below `minimum`. */
export function belowMinimum(running: string, minimum: string): boolean {
  const [left, right] = [release(running), release(minimum)]
  if (!parseVersion(left) || !parseVersion(right)) return false

  return compareVersions(left, right) < 0
}

/** Reads `versions.json` to determine the minimum Bun version required. */
export function bunShortfall(config: RunnerConfig): BunShortfall | null {
  const running = process.versions.bun
  if (!running) return null

  const minimum = pinnedMinimum(config.projectRoot)
  if (!minimum || !belowMinimum(running, minimum)) return null

  return { minimum, running }
}

function pinnedMinimum(root: string) {
  try {
    return readVersions(root).bunMinimum
  } catch {
    return null
  }
}
