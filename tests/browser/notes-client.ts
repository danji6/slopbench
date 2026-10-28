import type { MessageRow } from '@/lib/chat/rows'
import { DEFAULT_SETTINGS } from '@sb/convex/model/defaults'
import type { UIMessage } from 'ai'
import type { ConvexReactClient } from 'convex/react'
import { type FunctionReference, getFunctionName } from 'convex/server'

type NoteType = 'skills' | 'mcp' | 'workspace' | 'command'

function message(id: string, time: number, type?: NoteType) {
  const text = noteText(id)
  const parts: UIMessage['parts'] =
    id === 'work'
      ? [
          {
            type: 'tool-read_file',
            toolCallId: 'read',
            state: 'output-available',
            input: { path: 'notes.md' },
            output: 'File contents',
          },
        ]
      : type === 'command'
        ? []
        : [{ type: 'text', text }]
  return {
    _id: id,
    _creationTime: time,
    sessionId: 'notes',
    role: id === 'work' ? 'assistant' : type ? 'system' : 'user',
    sender: { type: 'agent', id: 'agent' },
    status: 'done',
    selectedVersion: 1,
    versionCount: 1,
    hidden: !!type,
    type,
    extra: noteExtra(type),
    segments: [{ segmentIndex: 0, parts, sizeBytes: text.length }],
    sizeBytes: text.length,
    hasOlderSegments: false,
    hasNewerSegments: false,
  }
}

function noteText(id: string) {
  const text =
    id === 'workspace'
      ? '<system-reminder>\n\n**Workspace details**\n\n' +
        'long-path/'.repeat(50) +
        '\n\n</system-reminder>'
      : `Content for ${id}`
  return text
}

function noteExtra(type?: NoteType) {
  return type === 'workspace'
    ? { label: 'Reverse Engineering' }
    : type === 'command'
      ? {
          name: 'timeout',
          argument: '30',
          status: 'failed',
          error: 'Command failed',
        }
      : undefined
}

const params = new URLSearchParams(location.search)
let messages = [
  ...Array.from({ length: 35 }, (_, i) => message(`before${i}`, i)),
  message('mcp', 40, 'mcp'),
  message('workspace', 41, 'workspace'),
  message('skills', 42, 'skills'),
  message('command', 43, 'command'),
  ...Array.from({ length: Number(params.get('extraNotes') ?? 0) }, (_, i) =>
    message(`note${i}`, 44 + i / 1000, 'skills'),
  ),
  ...(params.has('work') ? [message('work', 45)] : []),
  ...Array.from({ length: 35 }, (_, i) => message(`after${i}`, 50 + i)),
]
const cache = new Map<string, unknown>()
const listeners = new Set<() => void>()

function query(name: string, args: Record<string, unknown>) {
  const readOnly = new URLSearchParams(location.search).has('readOnly')
  if (name === 'settings:get') return DEFAULT_SETTINGS
  if (name === 'users:getProfile')
    return { _id: readOnly ? 'viewer' : 'owner', role: 'user' }
  if (name === 'sessions:get')
    return { _id: 'notes', ownerId: 'owner', settings: { disabled: readOnly } }
  if (name === 'chat:messagesWindow') {
    const unloaded =
      new URLSearchParams(location.search).has('unloaded') && !args.anchor
    return {
      page: unloaded ? messages.filter((m) => !m.hidden) : messages,
      hasOlder: unloaded,
      hasNewer: false,
      atTail: !args.anchor,
    }
  }
  if (name.endsWith(':list') || name === 'chat:processingMessageSegments')
    return []
  return null
}

export const notesClient = {
  watchQuery(
    reference: FunctionReference<'query'>,
    args: Record<string, unknown>,
  ) {
    const name = getFunctionName(reference)
    const key = `${name}:${JSON.stringify(args)}`
    return {
      onUpdate(callback: () => void) {
        listeners.add(callback)
        return () => listeners.delete(callback)
      },
      localQueryResult() {
        if (!cache.has(key)) cache.set(key, query(name, args))
        return cache.get(key)
      },
      localQueryLogs: () => [],
      journal: () => undefined,
    }
  },
  async mutation(
    reference: FunctionReference<'mutation'>,
    args: { messageId: string },
  ) {
    const name = getFunctionName(reference)
    const anchor = messages.find((m) => m._id === args.messageId)
    if (name === 'chat:deleteMessage')
      messages = messages.filter((m) => m._id !== args.messageId)
    if (name === 'chat:deleteMessagesFrom' && anchor)
      messages = messages.filter((m) => m._creationTime < anchor._creationTime)
    cache.clear()
    listeners.forEach((listener) => listener())
  },
} as unknown as ConvexReactClient

export function appendNote() {
  const index = messages.findIndex((m) => m._id === 'command')
  const extra = message('extra', 44)
  extra.hidden = true
  extra.segments[0].parts = []
  messages = [
    ...messages.slice(0, index + 1),
    extra,
    ...messages.slice(index + 1),
  ]
  cache.clear()
  listeners.forEach((listener) => listener())
}

export function isNoteRow(row: MessageRow) {
  return row.kind === 'hidden' || row.kind === 'note-group'
}
