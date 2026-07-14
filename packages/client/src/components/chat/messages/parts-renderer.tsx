import type { PartMetadata, UIMessageType } from '@/lib/chat'
import { groupKey, groupParts } from '@/lib/chat/parts'
import type { UIMessage } from 'ai'
import { useMemo } from 'react'

import { RenderGroup } from './render-group'

export type PartsRendererProps = {
  message: UIMessage
  type?: UIMessageType
  attachmentIds?: Record<string, string>
  partMeta?: PartMetadata
}

export function PartsRenderer({
  message,
  type,
  attachmentIds,
  partMeta,
}: PartsRendererProps) {
  const groups = useMemo(() => groupParts(message.parts), [message.parts])

  return (
    <>
      {groups.map((group) => (
        <RenderGroup
          key={groupKey(group)}
          message={message}
          type={type}
          group={group}
          attachmentIds={attachmentIds}
          partMeta={partMeta}
        />
      ))}
    </>
  )
}
