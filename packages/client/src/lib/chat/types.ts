import type { Doc, Id } from '@sb/convex/_generated/dataModel'
import type {
  ApproveToolArgs as CoreApproveToolArgs,
  CreateAgentArgs as CoreCreateAgentArgs,
  SessionListItem as CoreSessionListItem,
  SessionMember as CoreSessionMember,
  SessionParticipant as CoreSessionParticipant,
  UpdateAgentArgs as CoreUpdateAgentArgs,
  MessageRole,
} from '@sb/core/types'
import type { ChatStatus, FileUIPart, UIMessage } from 'ai'

export type { UIMessage }
export type * from '@sb/core/types'

export type SessionMember = CoreSessionMember<
  Doc<'userSessions'>,
  Doc<'users'>,
  Doc<'settings'>
>

export type SessionParticipant = CoreSessionParticipant<
  Id<'users'>,
  Id<'agents'>,
  Id<'avatars'>
>

export type SessionListItem = CoreSessionListItem<
  Doc<'sessions'>,
  Id<'users'>,
  Id<'agents'>,
  Id<'avatars'>
>

export type CreateAgentArgs = CoreCreateAgentArgs<Id<'agents'>>

export type UpdateAgentArgs = CoreUpdateAgentArgs<Id<'agents'>>

export type ApproveToolArgs = CoreApproveToolArgs<Id<'sessions'>>

export type UIAvatar = {
  thumbnail: string | null
  original: string | null
}

export type UsageTotals = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export type UIMetadata = {
  usage: UsageTotals
}

export type UIMessageType = 'summary'

type MessageMetadata = NonNullable<Doc<'messages'>['metadata']>

export type PartMetadata = Pick<MessageMetadata, 'duration' | 'toolErrors'>

/** Loaded segment boundaries within a message's flattened parts. */
export type MessageSegmentInfo = {
  /** The server-side segment index (gaps allowed). */
  index: number
  /** How many of the message's flattened parts belong to this segment. */
  partCount: number
}

export type MessageRecord = Pick<
  Doc<'messages'>,
  | 'sender'
  | 'senderSnapshot'
  | 'type'
  | 'selectedVersion'
  | 'versionCount'
  | '_creationTime'
> & {
  metadata?: Pick<MessageMetadata, 'error' | 'warnings' | 'usage'>
  segments: MessageSegmentInfo[]
  /** Whether older segments of this message exist but aren't loaded. */
  hasOlderSegments: boolean
  hasNewerSegments: boolean
}

export type SessionMessage = {
  message: UIMessage
  type?: UIMessageType
}

export type SessionOptions = {
  modelId?: string
  reasoningEffort?: string
}

export type SessionUpdate = Partial<Omit<Doc<'sessions'>, '_id'>>

export type MessagesEventData = {
  messages: SessionMessage[]
  messageIds: string[]
  messagesById: Map<string, SessionMessage>
  lastMessageId: string | null
  status: ChatStatus
  metadata?: UIMetadata
  summaryId?: string
}

export type UIModel = {
  id: string
  label?: string
  contextWindow?: number
  local?: boolean
}

export type UIModelConfig = {
  models: UIModel[]
}

export type PendingMessage = {
  content: string
  files: FileUIPart[]
  role?: MessageRole
  originalFiles?: Record<string, File>
  silent?: boolean
}

export type ToolMetadata = {
  name: string
  description?: string
  category?: string
  requiresAdmin?: boolean
  requiresWorkspace?: boolean
}
