import type { Doc } from '@sb/convex/_generated/dataModel'
import { type buildProviderHistory } from '@sb/convex/actions/stream/history'
import type { UIMessage } from 'ai'

export const SELF = 'agent_self' as Doc<'agents'>['_id']

export const OTHER = 'agent_other' as Doc<'agents'>['_id']

export const USER = 'user_1' as Doc<'users'>['_id']

export function agent(
  contextOptions: Partial<Doc<'agents'>> = {},
): Doc<'agents'> {
  return {
    _id: SELF,
    trimContext: false,
    contextWindow: -1,
    outputTokens: -1,
    shareUserDisplayNames: false,
    shareAgentDisplayNames: false,
    maskOtherAgents: false,
    ...contextOptions,
  } as Doc<'agents'>
}

export function stored(
  sender: Doc<'messages'>['sender'],
  role: Doc<'messages'>['role'],
  name: string,
): Doc<'messages'> {
  return { sender, role, senderName: name } as Doc<'messages'>
}

/**
 * An injected note. It carries the sender of whichever agent was active when
 * it was written, which is not the agent that later reads it.
 */
export function note(
  sender: Doc<'messages'>['sender'],
  role: Doc<'messages'>['role'],
  name: string,
  type: NonNullable<Doc<'messages'>['type']> = 'reminder',
): Doc<'messages'> {
  return { ...stored(sender, role, name), type, hidden: true }
}

export function providerData(boundaryId?: string) {
  return {
    stream: {
      state: { phase: 'streaming', processingMessageId: 'output' },
      _id: 'stream_1',
      contextBoundaryMessageId: boundaryId,
    },
    session: {},
    agent: agent(),
    settings: {},
    sessionCache: { tools: { names: ['read_attachment'] } },
  } as never
}

export function providerDataWithWorkspace() {
  return {
    stream: {
      state: { phase: 'streaming', processingMessageId: 'output' },
      _id: 'stream_1',
    },
    session: {
      _id: 'session_1',
      workspace: { workspaceId: 'ws_1', label: 'ws' },
    },
    agent: agent(),
    settings: {},
  } as never
}

/** Run `fn` with `globalThis.fetch` replaced (used to stub the sidecar). */
export async function withFetch<T>(
  handler: (input: unknown) => Response | Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = handler as never
  try {
    return await fn()
  } finally {
    globalThis.fetch = original
  }
}

export function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

export function userMessage(parts: unknown[]): Doc<'messages'> {
  return {
    _id: 'message_1',
    role: 'user',
    sender: { type: 'user', id: USER },
    senderName: 'Alice',
    parts,
  } as unknown as Doc<'messages'>
}

export function attachmentHistoryCtx({
  message,
  attachment,
  blobs,
}: {
  message: Doc<'messages'>
  attachment: {
    storageId: string
    previewStorageId?: string
    previewMediaType?: string
    mediaType: string
    filename: string
    shareToken?: string
    byteLength?: number
  }
  blobs: Record<string, Blob>
}) {
  return {
    runQuery: async (_query: unknown, args: Record<string, unknown>) => {
      if ('streamId' in args) return [message]
      if ('attachmentId' in args) return attachment
      return null
    },
    storage: {
      get: async (id: string) => blobs[id] ?? null,
    },
  } as never
}

export function attachmentMessage(
  attachmentId: string,
  mediaType: string,
  filename: string,
) {
  return userMessage([
    {
      type: 'file',
      url: `attachment:${attachmentId}`,
      attachmentId,
      mediaType,
      filename,
    },
  ])
}

export function firstContentPart(
  history: Awaited<ReturnType<typeof buildProviderHistory>>,
) {
  const first = history[0]
  if (!first || typeof first.content === 'string') return null
  return first.content[0] ?? null
}

export const textAndToolParts: UIMessage['parts'] = [
  { type: 'reasoning', text: 'thinking' },
  { type: 'text', text: 'hello' },
  {
    type: 'tool-web_fetch',
    toolCallId: 't1',
    state: 'output-available',
  } as never,
]
