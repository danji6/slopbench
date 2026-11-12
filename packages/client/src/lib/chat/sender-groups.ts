import type { UIMessage } from 'ai'

import { isShellReportPart } from './parts'
import type { MessageRecord, PartMetadata } from './types'

/** Presents background shell reports as activity from their owning agent. */
export function messageDisplayRole(
  message: UIMessage,
  record: MessageRecord | undefined,
): UIMessage['role'] {
  const isAgentReport =
    message.role === 'user' &&
    record?.sender.type === 'agent' &&
    message.parts.some(isShellReportPart)
  return isAgentReport ? 'assistant' : message.role
}

/** Identifies messages that can share a sender header. */
export function messageSenderKey(
  message: UIMessage,
  record: MessageRecord | undefined,
): string | null {
  if (!record?.sender || record.type) return null
  const role = messageDisplayRole(message, record)
  return `${role}:${record.sender.type}:${record.sender.id}`
}

type FooterDurationOptions = {
  ids: string[]
  getMessage: (id: string) => UIMessage | null
  getMetadata: (id: string) => MessageRecord | undefined
  getPartMetadata: (id: string) => PartMetadata | undefined
  groupBySender: boolean
}

/** Places each completed agent group's total duration on its last message. */
export function senderGroupDurations({
  ids,
  getMessage,
  getMetadata,
  getPartMetadata,
  groupBySender,
}: FooterDurationOptions): Map<string, number> {
  const durations = new Map<string, number>()
  let previousKey: string | null = null
  let lastId: string | undefined
  let duration = 0
  let processing = false

  const finishGroup = () => {
    if (lastId && duration > 0 && !processing) {
      durations.set(lastId, duration)
    }
  }

  for (const id of ids) {
    const message = getMessage(id)
    if (!message) continue
    const record = getMetadata(id)
    if (record?.hidden) continue

    const key = messageSenderKey(message, record)
    const grouped = groupBySender && key !== null && key === previousKey
    if (!grouped) {
      finishGroup()
      duration = 0
      processing = false
    }
    previousKey = key
    lastId = id
    if (messageDisplayRole(message, record) === 'assistant') {
      duration += Math.max(0, getPartMetadata(id)?.duration ?? 0)
    }
    processing ||= (message as { status?: string }).status === 'processing'
  }

  finishGroup()
  return durations
}
