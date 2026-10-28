import type {
  MessageStore,
  MessageWindowMetadata,
} from '@/lib/chat/message-store'
import type { MessageRecord } from '@/lib/chat/types'

import { type Part, message, meta } from './work-layout'

export function entry(time: number, parts: Part[], start = 0) {
  return {
    message: message(parts, `m${time}`),
    record: {
      ...meta(
        parts.map(() => 1),
        start,
      ),
      _creationTime: time,
      sender: { type: 'agent', id: `agent${time}` },
      sizeBytes: parts.length,
    } as MessageRecord,
  }
}

export const initialWindowMeta: MessageWindowMetadata = {
  pageRevision: 0,
  navigationRevision: 0,
  isLoadingFirstPage: false,
  isLoadingOlder: false,
  isLoadingNewer: false,
  isAtLiveTail: false,
  isSliding: false,
  canLoadOlder: true,
  canLoadNewer: true,
}

export function syncPage(
  store: MessageStore,
  entries: ReturnType<typeof entry>[],
  meta: Partial<MessageWindowMetadata> = {},
) {
  store.sync({
    sessionId: 'session',
    results: entries.map((e) => e.message),
    messageMetaByMessage: new Map(entries.map((e) => [e.message.id, e.record])),
    partMetaByMessage: new Map(),
    groupBySender: false,
    resetKey: 0,
    meta: { ...initialWindowMeta, ...meta },
    controls: {
      extendOlder: () => false,
      extendNewer: () => false,
      anchorAround: () => {},
      returnToLatest: () => {},
      returnToOldest: () => {},
    },
  })
}
