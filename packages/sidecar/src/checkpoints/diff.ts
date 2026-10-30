import type { ChangePublication } from '@sb/core/types/changes'
import { createUnifiedDiff, normalizeToLf } from '@sb/core/workspace/edit'
import { TextDecoder } from 'node:util'

import { sameFile } from './snapshot'
import { type CheckpointStorage, digest } from './storage'
import type { CheckpointFile, Snapshot } from './types'

const MAX_DIFF_CHARS = 100_000
const MAX_TEXT_BYTES = 1024 * 1024
const MAX_TURN_PREVIEW_CHARS = 4 * 1024 * 1024
const decoder = new TextDecoder('utf-8', { fatal: true })

export function changedFiles(
  before: Snapshot,
  after: Snapshot,
): CheckpointFile[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .filter((target) => !sameFile(before[target], after[target]))
    .map((target) => ({
      target,
      path: target,
      before: before[target],
      after: after[target],
    }))
}

/** Builds display data from complete snapshots, never from truncated tool output. */
export async function publication(
  storage: CheckpointStorage,
  id: string,
  changes: CheckpointFile[],
  issues: string[],
): Promise<ChangePublication> {
  const files: ChangePublication['files'] = []
  const diffs: Record<string, string> = {}
  let previewChars = 0

  for (const change of changes) {
    const before = change.before
      ? await storage.bytes(change.before.hash)
      : Buffer.alloc(0)
    const after = change.after
      ? await storage.bytes(change.after.hash)
      : Buffer.alloc(0)
    const key = digest(change.target)
    const display = fileDiff(change.path, before, after)
    const previewBudgetExceeded =
      previewChars + display.diff.length > MAX_TURN_PREVIEW_CHARS
    diffs[key] = previewBudgetExceeded
      ? 'Turn preview budget exceeded. This file is still included in revert/reapply.'
      : display.diff
    previewChars += diffs[key].length
    files.push({
      key,
      path: change.path,
      kind: !change.before ? 'added' : !change.after ? 'deleted' : 'modified',
      additions: display.additions,
      deletions: display.deletions,
      binary: display.binary,
      truncated: display.truncated || previewBudgetExceeded,
    })
  }

  return {
    id,
    revision: 0,
    state: 'applied',
    files,
    diffs,
    issues,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  }
}

function fileDiff(filename: string, before: Buffer, after: Buffer) {
  const binary = isBinary(before) || isBinary(after)
  const tooLarge = before.length + after.length > MAX_TEXT_BYTES

  if (binary || tooLarge) {
    return {
      diff: binary ? 'Binary file changed.' : 'File is too large to preview.',
      additions: 0,
      deletions: 0,
      binary,
      truncated: tooLarge,
    }
  }

  const diff = createUnifiedDiff(
    filename,
    normalizeToLf(decoder.decode(before)),
    normalizeToLf(decoder.decode(after)),
  )

  const lines = diff.split('\n').slice(2)
  const additions = lines.filter((line) => line.startsWith('+')).length
  const deletions = lines.filter((line) => line.startsWith('-')).length
  const truncated = diff.length > MAX_DIFF_CHARS

  return {
    diff: truncated
      ? `${diff.slice(0, MAX_DIFF_CHARS)}\n[diff truncated]`
      : diff || 'File bytes or metadata changed.',
    additions,
    deletions,
    binary,
    truncated,
  }
}

function isBinary(bytes: Buffer) {
  if (bytes.subarray(0, 8192).includes(0)) return true
  try {
    decoder.decode(bytes)
    return false
  } catch {
    return true
  }
}
