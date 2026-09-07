import { limitError } from '../limit-errors'
import { MAX_APPROVAL_PATHS, MAX_APPROVAL_PATH_BYTES } from '../limits'

export function normalizeApprovalPath(value: string): string {
  const absolute = value.startsWith('/')
  const parts: string[] = []
  for (const part of value.split('/')) {
    if (!part || part === '.') continue
    if (part === '..' && parts.length && parts.at(-1) !== '..') parts.pop()
    else if (part === '..' && absolute) continue
    else parts.push(part)
  }
  return `${absolute ? '/' : ''}${parts.join('/')}` || '.'
}

export function isPathForbidden(value: string): boolean {
  return /(^|[\\/])\.git([\\/]|$)/.test(value)
}

/** Exact path or descendant, without granting sibling prefixes. */
export function isPathWithin(value: string, entry: string): boolean {
  if (value === entry) return true
  if (entry === '.')
    return !value.startsWith('/') && value !== '..' && !value.startsWith('../')
  return value.startsWith(entry.endsWith('/') ? entry : `${entry}/`)
}

/** A grant must explicitly enter every protected .git subtree it covers. */
export function isPathAllowed(value: string, allowed: string[]): boolean {
  const target = normalizeApprovalPath(value)
  const protectedRoot = target.match(/^(.*(?:^|\/)\.git)(?:\/|$)/)?.[1]
  return allowed.some((raw) => {
    const entry = normalizeApprovalPath(raw)
    return (
      isPathWithin(target, entry) &&
      (!protectedRoot || isPathWithin(entry, protectedRoot))
    )
  })
}

/** Keep explicit .git grants even when an ordinary parent is already present. */
export function foldPaths(paths: string[]): string[] {
  const unique = [...new Set(paths.map(normalizeApprovalPath))]
  return unique.filter(
    (value) =>
      !unique.some((entry) => entry !== value && isPathAllowed(value, [entry])),
  )
}

export function approvalPathSyntaxError(value: string): string | null {
  if (!value.trim() || /\p{Cc}/u.test(value))
    return 'Enter a non-empty path without control characters.'
  if (/^~|\$/.test(value))
    return 'Home and environment variable shorthand are not supported.'
  return null
}

export function approvalPathsError(paths: string[]): string | null {
  if (paths.length > MAX_APPROVAL_PATHS) {
    return limitError('approvalPaths')
  }
  if (approvalPathsBytes(paths) > MAX_APPROVAL_PATH_BYTES) {
    return limitError('approvalPathBytes')
  }
  return paths.map(approvalPathSyntaxError).find(Boolean) ?? null
}

export function approvalPathsBytes(paths: string[]): number {
  return new TextEncoder().encode(JSON.stringify(paths)).byteLength
}

/** Remember as much as fits, without failing an approval the user already gave. */
export function capApprovalPaths(paths: string[]): string[] {
  const result: string[] = []
  for (const raw of paths) {
    if (approvalPathSyntaxError(raw)) continue
    const value = normalizeApprovalPath(raw.trim())
    if (result.includes(value)) continue
    if (result.length >= MAX_APPROVAL_PATHS) break
    if (approvalPathsBytes([...result, value]) <= MAX_APPROVAL_PATH_BYTES)
      result.push(value)
  }
  return result
}

export type CheckedPath = {
  path: string
  absolutePath: string
  inputPath: string
  allowed: boolean
  outside: boolean
  forbidden: boolean
}

export type PathCheckResult = {
  flagged: string[]
  uncovered: string[]
  resolved: CheckedPath[]
  complete: boolean
}

export type PathApprovalStatus = 'forbidden' | 'paths' | 'analysis' | null

export function pathApprovalStatus(
  result: PathCheckResult | null,
): PathApprovalStatus {
  if (!result?.complete) {
    return 'analysis'
  }
  if (result.resolved.some((item) => item.forbidden && !item.allowed)) {
    return 'forbidden'
  }
  return result.uncovered.length ? 'paths' : null
}
