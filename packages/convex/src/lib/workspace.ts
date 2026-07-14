import type {
  WorkspaceDirectoryLink,
  WorkspaceTextLink,
} from '@sb/core/types/workspace'

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
  return `<plan status="${snapshot.status}">\n${snapshot.content}\n</plan>`
}

/** Collapse control whitespace and escape characters that break the path attribute. */
export function escapeBlockPath(path: string): string {
  const normalized = path.trim().replace(/[\r\n\t]+/g, ' ') || 'file'
  return normalized
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function toFileBlock(link: WorkspaceTextLink) {
  return `<file path="${escapeBlockPath(link.path)}">\n${link.content}\n</file>`
}

export function toDirectoryBlock(link: WorkspaceDirectoryLink) {
  return `<directory path="${escapeBlockPath(link.path)}">\n${link.entries.join('\n')}\n</directory>`
}

export function openFileBlock(path: string) {
  return `<file path="${escapeBlockPath(path)}">`
}

export function closeFileBlock() {
  return '</file>'
}
