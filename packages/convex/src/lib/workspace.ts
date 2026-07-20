import type {
  WorkspaceDirectoryLink,
  WorkspaceTextLink,
} from '@sb/core/types/workspace'
import { block, closeBlock, openBlock } from '@sb/core/utils/blocks'
import { blockPath, fileBlock } from '@sb/core/workspace/blocks'

import { SUBAGENT_REPORT_PREFIX } from './subagent'

export const FILE_BLOCK_PREFIXES = ['<file path="', '<directory path="']
export const PLAN_BLOCK_PREFIX = '<plan status="'

/** All injected context blocks (skipped by sender name prefixing). */
export const INJECTED_BLOCK_PREFIXES = [
  ...FILE_BLOCK_PREFIXES,
  PLAN_BLOCK_PREFIX,
  SUBAGENT_REPORT_PREFIX,
]

export function toPlanBlock(snapshot: { content: string; status: string }) {
  return block('plan', snapshot.content, { status: snapshot.status })
}

export function toFileBlock(link: WorkspaceTextLink) {
  return fileBlock(link.path, link.content)
}

export function toDirectoryBlock(link: WorkspaceDirectoryLink) {
  return block('directory', link.entries.join('\n'), {
    path: blockPath(link.path),
  })
}

export function openFileBlock(path: string) {
  return openBlock('file', { path: blockPath(path) })
}

export function closeFileBlock() {
  return closeBlock('file')
}
