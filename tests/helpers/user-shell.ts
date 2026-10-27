import type { ShellToolOutput } from '@sb/core/types/tools'
import { getFunctionName } from 'convex/server'

export type Part = Record<string, unknown>

export const TOOL_CALL_ID = 'call-1'

export function shellPart(overrides: Part = {}): Part {
  return {
    type: 'tool-shell',
    toolCallId: TOOL_CALL_ID,
    state: 'input-available',
    input: { command: 'ls -la' },
    ...overrides,
  }
}

export function output(
  overrides: Partial<ShellToolOutput> = {},
): ShellToolOutput {
  return {
    jobId: 'job-1',
    status: 'done',
    exitCode: 0,
    text: 'a.txt\nb.txt',
    term: '[32ma.txt[0m\nb.txt',
    termOffset: 0,
    ...overrides,
  }
}

/** Minimal mutation ctx over one message and its single content row. */
export function mutationCtx(
  parts: Part[],
  message: Record<string, unknown> = {},
) {
  const doc: Record<string, unknown> = {
    _id: 'msg-1',
    sessionId: 'session-1',
    sender: { type: 'user', id: 'user-1' },
    status: 'processing',
    selectedVersion: 1,
    _creationTime: Date.now(),
    ...message,
  }
  const row = { _id: 'row-1', messageId: 'msg-1', version: 1, segmentIndex: 0, parts } // prettier-ignore
  // A titled session keeps `scheduleTitle` from doing anything
  const session = {
    _id: 'session-1',
    title: 'Session',
    folderId: 'folder-1',
  }
  const scheduled: unknown[] = []

  const ctx = {
    db: {
      get: async (id: string) =>
        id === 'msg-1'
          ? doc
          : id === 'session-1'
            ? session
            : id === 'folder-1'
              ? {
                  _id: 'ws-1',
                  name: 'Test',
                  revision: 0,
                  sources: [{ id: 'root', path: '/repo', label: 'repo' }],
                }
              : null,
      patch: async (id: string, fields: Record<string, unknown>) => {
        Object.assign(id === 'row-1' ? row : doc, fields)
      },
      // The sender has no settings row, so their shell is the sidecar's default
      query: (table: string) => ({
        withIndex: () => ({
          unique: async () => (table === 'settings' ? null : row),
          collect: async () => [row],
          order: () => ({ first: async () => null }),
          first: async () => null,
        }),
      }),
    },
    scheduler: {
      runAfter: async (_delay: number, ref: unknown) => {
        scheduled.push(ref)
      },
    },
  }

  return { ctx, doc, row, scheduled }
}

export function partOf(row: { parts: Part[] }): Part {
  return row.parts[0]
}

export type RunnerOptions = {
  /** False once the message the command belongs to is gone. */
  alive?: boolean
  /** Null when the command can no longer be claimed. */
  claim?: Record<string, unknown> | null
  /** Keeps the scripted stream open so the window deadline can end it. */
  stayOpen?: boolean
}

/** Collects the mutations `_run` makes against a scripted shell job. */
export function runnerCtx(
  outputs: ShellToolOutput[],
  { alive = true, claim, stayOpen }: RunnerOptions = {},
) {
  const patches: ShellToolOutput[] = []
  const finishes: Record<string, unknown>[] = []
  const scheduled: string[] = []
  const posts: string[] = []

  const ctx = {
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = getFunctionName(ref as never)
      if (name.endsWith('_beginUserShellWindow')) {
        return claim === undefined
          ? {
              sessionId: 'session-1',
              workspaceId: 'ws-1',
              command: 'ls -la',
              toolCallId: TOOL_CALL_ID,
              startedAt: Date.now(),
            }
          : claim
      }
      if (name.endsWith('_patchUserShell')) {
        patches.push(args.output as ShellToolOutput)
        return alive
      }
      finishes.push(args)
      return undefined
    },
    scheduler: {
      runAfter: async (_delay: number, ref: unknown) => {
        scheduled.push(getFunctionName(ref as never))
      },
    },
  }

  const post = async (path: string) => {
    posts.push(path)
    return { jobId: 'job-1', mode: 'foreground' }
  }
  async function* openStream(
    _path: string,
    _query: Record<string, string>,
    signal?: AbortSignal,
  ) {
    for (const next of outputs) {
      yield {
        event: next.status === 'running' ? 'chunk' : 'end',
        data:
          next.status === 'running'
            ? JSON.stringify({ text: next.term, nextOffset: next.term.length })
            : JSON.stringify({ status: next.status, exitCode: next.exitCode }),
      }
    }
    if (!stayOpen) return
    await new Promise<void>((resolve) =>
      signal?.addEventListener('abort', () => resolve(), { once: true }),
    )
  }

  return { ctx, patches, finishes, scheduled, posts, post, openStream }
}
