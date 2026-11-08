import type { MessageRow } from '@/lib/chat/rows'
import { DEFAULT_SETTINGS } from '@sb/convex/model/defaults'
import type { UIMessage } from 'ai'
import type { ConvexReactClient } from 'convex/react'
import { type FunctionReference, getFunctionName } from 'convex/server'

type NoteType = 'skills' | 'mcp' | 'workspace' | 'command' | 'todo'

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
let messages = initialMessages()

function initialMessages() {
  if (params.has('reminderWork')) return reminderWorkMessages()
  if (params.has('thinkingWork')) return thinkingWorkMessages()
  if (params.has('compaction')) return compactionMessages()
  if (params.has('fileChanges')) return fileChangeMessages()
  if (params.has('shellReports')) return shellMessages()
  if (params.has('tailWork')) return tailWorkMessages()
  if (params.has('groupedWork')) return groupedWorkMessages()
  return [
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
}

function reminderWorkMessages() {
  const [first, second] = groupedWorkMessages()
  first.segments[0].parts = [
    { type: 'reasoning', text: 'Reviewing the work.', state: 'done' },
    ...reminderWorkParts(),
  ]
  return [first, message('todo', 0.5, 'todo'), second]
}

function reminderWorkParts(): UIMessage['parts'] {
  switch (params.get('lastBlock')) {
    case 'shell':
      return [
        {
          type: 'tool-shell',
          toolCallId: 'command',
          state: 'output-available',
          input: { command: 'bun test' },
          output: 'Tests passed.',
        },
      ]
    case 'file':
      return [
        {
          type: 'tool-write_file',
          toolCallId: 'write',
          state: 'output-available',
          input: { path: 'notes.ts', content: 'export const done = true' },
          output: { path: 'notes.ts', diff: '+export const done = true' },
        },
      ]
    default:
      return message('work', 0).segments[0].parts
  }
}

function thinkingWorkMessages() {
  return [
    {
      ...message('work', 0),
      metadata: { duration: 146_000 },
      segments: [
        {
          segmentIndex: 0,
          parts: [
            {
              type: 'reasoning',
              text: 'First thinking block.',
              state: 'done',
              duration: 10_000,
            },
            ...(params.get('thinkingWork') === 'single'
              ? []
              : [
                  {
                    type: 'reasoning',
                    text: 'Second thinking block.',
                    state: 'done',
                    duration: 62_000,
                  },
                ]),
            ...(params.has('mixedThinking')
              ? message('work', 0).segments[0].parts
              : []),
            { type: 'text', text: 'Finished thinking.' },
          ] as UIMessage['parts'],
          sizeBytes: 100,
        },
      ],
    },
  ]
}

function compactionMessages() {
  const longSummary = params.has('longSummary')
  const command = {
    ...message('command', 0, 'command'),
    extra: { name: 'compact', argument: '', status: 'done' },
  }
  const summary = {
    ...message('summary', 1),
    role: 'assistant',
    type: 'summary' as const,
    segments: [
      {
        segmentIndex: 0,
        parts: [
          {
            type: 'reasoning' as const,
            text: 'Checking completed task status.',
          },
          {
            type: 'text' as const,
            text: longSummary
              ? 'Summary of the completed work.\n\n'.repeat(24)
              : 'Summary of the completed work.',
          },
        ],
        sizeBytes: 100,
      },
    ],
  }
  if (longSummary) {
    const history = Array.from({ length: 16 }, (_, index) =>
      message(`before${index}`, index - 16),
    )
    return [...history, command, summary]
  }
  return [
    command,
    summary,
    message('mcp', 2, 'mcp'),
    message('workspace', 3, 'workspace'),
    message('skills', 4, 'skills'),
    message('work', 5),
  ]
}

function fileChangeMessages(waitingForInput = false) {
  const longShell = params.has('longShell')
  const work = message('work', 0)
  work.segments[0].parts = [
    {
      type: 'tool-edit_file',
      toolCallId: 'edit',
      state: 'output-available',
      input: { path: 'first.ts' },
      output: { path: 'first.ts', diff: '-oldFirst\n+newFirst' },
    },
    { type: 'step-start' },
    {
      type: 'tool-write_file',
      toolCallId: 'write',
      state: 'output-available',
      input: { path: 'second.ts', content: 'newSecond' },
      output: { path: 'second.ts', diff: '+newSecond' },
    },
    {
      type: 'tool-edit_file',
      toolCallId: 'failed',
      state: 'output-error',
      input: { path: 'first.ts' },
      errorText: 'Original text was not found',
    },
    {
      type: 'tool-shell',
      toolCallId: 'verify',
      state: 'output-available',
      input: { command: 'bun test', description: 'Verify file changes.' },
      output: {
        jobId: 'verify-job',
        status: waitingForInput ? 'running' : 'done',
        exitCode: waitingForInput ? null : 0,
        waiting: waitingForInput,
        term: 'All checks passed.\r\n'.repeat(longShell ? 30 : 1),
        termOffset: 0,
      },
    },
    { type: 'text', text: 'File changes finished.' },
  ]
  if (!longShell) return [work]
  const history = Array.from({ length: 16 }, (_, index) =>
    message(`before${index}`, index - 16),
  )
  return [...history, work]
}

function tailWorkMessages() {
  const work = message('work', 45)
  work.segments[0].parts = Array.from({ length: 8 }, (_, index) => [
    {
      type: 'tool-read_file' as const,
      toolCallId: `read${index}`,
      state: 'output-available' as const,
      input: { path: `file${index}.ts` },
      output: 'File contents',
    },
    { type: 'reasoning' as const, text: 'Checking the implementation.' },
  ]).flat()
  if (params.has('singleEdit')) {
    work.segments[0].parts = [
      {
        type: 'tool-edit_file',
        toolCallId: 'edit',
        state: 'output-available',
        input: { path: 'file.ts' },
        output: { path: 'file.ts', diff: '-old\n+new' },
      },
      {
        type: 'reasoning',
        text: 'Checking the edit.',
        state: 'done',
      },
    ]
  }
  work.segments[0].parts.push({
    type: 'text',
    text: 'Regression checks passed.\n\n'.repeat(10),
  })
  return [
    ...Array.from({ length: 35 }, (_, index) =>
      message(`before${index}`, index),
    ),
    work,
  ]
}

function groupedWorkMessages() {
  return ['first', 'second'].map((id, index) => ({
    ...message('work', index),
    _id: id,
    hasChanges: index === 0 && params.has('emptyChanges'),
    metadata: { duration: 8300 },
  }))
}

function shellMessages() {
  const shell = (id: string) => ({
    type: 'tool-shell',
    toolCallId: id,
    state: 'output-available',
    input: { command: `printf ${id}` },
    output:
      id === 'agent2'
        ? {
            jobId: 'job',
            status: 'background',
            exitCode: null,
            text: '',
            term: '',
            termOffset: 0,
          }
        : `${id} output`,
  })
  const parts = [
    [shell('user')],
    [
      shell('agent1'),
      { type: 'step-start' },
      shell('agent2'),
      { type: 'text', text: 'Agent progress' },
    ],
    [
      {
        type: 'shell-report',
        jobId: 'job',
        command: 'bun lint',
        status: 'done',
        exitCode: 0,
        text: 'Lint passed',
      },
    ],
    [
      {
        type: 'tool-shell_output',
        toolCallId: 'poll',
        state: 'output-available',
        input: { jobId: 'job' },
        output: 'Command output',
      },
      {
        type: 'tool-shell_output',
        toolCallId: 'poll-next',
        state: 'output-available',
        input: { jobId: 'next-job' },
        output: 'Next command output',
      },
      { type: 'text', text: 'Finished' },
    ],
  ] as unknown as UIMessage['parts'][]

  return parts.map((parts, index) => ({
    ...message('work', index),
    _id: `shell${index}`,
    role: index === 0 || index === 2 ? 'user' : 'assistant',
    sender: {
      type: index === 0 ? 'user' : 'agent',
      id: index === 0 ? 'owner' : 'agent',
    },
    senderName: index === 0 ? 'User' : 'Code',
    metadata: { duration: index === 1 ? 109000 : index === 3 ? 37000 : 0 },
    segments: [{ segmentIndex: 0, parts, sizeBytes: 100 }],
  }))
}
const cache = new Map<string, unknown>()
const listeners = new Set<() => void>()

function query(name: string, args: Record<string, unknown>) {
  const readOnly = new URLSearchParams(location.search).has('readOnly')
  if (name === 'settings:get')
    return {
      ...DEFAULT_SETTINGS,
      groupBySender: params.has('ungrouped')
        ? false
        : DEFAULT_SETTINGS.groupBySender,
    }
  if (name === 'users:getProfile')
    return { _id: readOnly ? 'viewer' : 'owner', role: 'user' }
  if (name === 'sessions:get')
    return { _id: 'notes', ownerId: 'owner', settings: { disabled: readOnly } }
  if (name === 'tools:list' && params.has('longShell'))
    return [{ name: 'shell' }]
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
  async action(reference: FunctionReference<'action'>) {
    if (getFunctionName(reference) === 'actions/terminals:list') {
      return { jobs: [] }
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

export function waitForShellInput() {
  messages = fileChangeMessages(true)
  cache.clear()
  listeners.forEach((listener) => listener())
}

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
