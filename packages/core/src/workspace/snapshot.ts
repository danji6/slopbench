import type { WorkspaceLinkSnapshot } from '../types/workspace'
import {
  MAX_DIR_ENTRIES,
  MAX_SNAPSHOT_LABEL_CHARS,
  MAX_TEXT_SNAPSHOT_CHARS,
} from './files'

const label = (value: string) => value.slice(0, MAX_SNAPSHOT_LABEL_CHARS)

/** Reapplies the snapshot caps to a link handed back by the client. */
export function clampLinkSnapshot<TStorageId extends string>(
  snapshot: WorkspaceLinkSnapshot<TStorageId>,
): WorkspaceLinkSnapshot<TStorageId> {
  const path = label(snapshot.path)

  switch (snapshot.kind) {
    case 'text':
      return {
        ...snapshot,
        path,
        content: snapshot.content.slice(0, MAX_TEXT_SNAPSHOT_CHARS),
        truncated:
          snapshot.truncated ||
          snapshot.content.length > MAX_TEXT_SNAPSHOT_CHARS,
      }
    case 'directory':
      return {
        ...snapshot,
        path,
        entries: snapshot.entries.slice(0, MAX_DIR_ENTRIES).map(label),
        truncated:
          snapshot.truncated || snapshot.entries.length > MAX_DIR_ENTRIES,
      }
    case 'binary-ref':
      return { ...snapshot, path, filename: label(snapshot.filename) }
    case 'skipped':
      return { ...snapshot, path, reason: label(snapshot.reason) }
  }
}
