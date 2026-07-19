import { homedir } from 'node:os'
import path from 'node:path'

const HOME = homedir()

/** Expand a leading `~` back into the absolute home directory. */
export function expandHome(input: string): string {
  if (input === '~') return HOME
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(HOME, input.slice(2))
  }
  return input
}

/** Throw when `candidate` resolves outside `root`. */
export function assertInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  if (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  ) {
    return
  }
  throw new Error('Path escapes the configured workspace')
}

/** Collapse a leading home directory into `~` for display. */
export function collapseHome(input: string): string {
  const relative = path.relative(HOME, input)
  if (relative === '') return '~'
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    return `~${path.sep}${relative}`
  }
  return input
}
