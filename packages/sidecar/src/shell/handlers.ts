import { shellLabel } from '@sb/core/shell/name'
import type { Context, Handler } from 'hono'
import { streamSSE } from 'hono/streaming'
import { ZodError, z } from 'zod'

import { withAgentFiles } from '../agent-files/access'
import {
  withWorkspaceOperation,
  workspaceContextSchema,
} from '../mcp/workspace/context'
import { resolveShellDirectory } from './directory'
import {
  type ShellJobStream,
  backgroundShellJob,
  killSessionShellJobs,
  killShellJob,
  listShellJobs,
  pollShellJob,
  resizeShellJob,
  startShellJob,
  subscribeShellJob,
  writeStdin,
} from './registry'
import { pumpShellJobStream } from './stream'
import { shellPath } from './system-shell'

const jobFields = {
  sessionId: z.string(),
  jobId: z.string(),
}

const startSchema = z.strictObject({
  sessionId: z.string(),
  owner: z.string().optional(),
  messageId: z.string().optional(),
  messageCreatedAt: z.number().optional(),
  toolCallId: z.string().optional(),
  workspaceId: z.string(),
  workspace: workspaceContextSchema,
  command: z.string().min(1),
  cwd: z.string().optional(),
  allowedPaths: z.array(z.string()).optional(),
  timeoutSeconds: z.number().optional(),
  background: z.boolean().optional(),
  cols: z.number().int().min(20).max(500).optional(),
  rows: z.number().int().min(5).max(300).optional(),
  shell: z.string().optional(),
  allowInteractiveShells: z.boolean().optional(),
})

const pollSchema = z.object({ ...jobFields, offset: z.number().min(0) })
const streamSchema = z.object({
  ...jobFields,
  offset: z.coerce.number().min(0).default(0),
  // Ends the SSE response once this many payload bytes have been sent
  maxBytes: z.coerce.number().min(0).optional(),
})
const stdinSchema = z.object({ ...jobFields, data: z.string() })
const killSchema = z.object(jobFields)
const resizeSchema = z.object({
  ...jobFields,
  cols: z.number().int().min(20).max(500),
  rows: z.number().int().min(5).max(300),
})
const sessionSchema = z.object({ sessionId: z.string() })
const killSessionSchema = z.object({
  sessionId: z.string(),
  owner: z.string().optional(),
  includeBackground: z.boolean().optional(),
})

/** What an unconfigured shell resolves to on this host. */
export const shellInfo: Handler = (c) => {
  try {
    const shell = shellPath()
    return c.json({ shell, label: shellLabel(shell) })
  } catch (err: unknown) {
    return jobError(c, err)
  }
}

export const startShell: Handler = async (c) => {
  try {
    const input = startSchema.parse(await c.req.json())
    const result = await withAgentFiles(
      input.workspace.agentHome?.homeId ?? input.workspace.agentHome?.agentId,
      () =>
        withWorkspaceOperation(input.sessionId, async () => {
          const directory = await resolveShellDirectory(input)
          return startShellJob({
            ...input,
            agentId: input.workspace.agentHome?.agentId,
            homeId: input.workspace.agentHome?.homeId,
            cwd: directory.cwd,
            environment: directory.environment,
          })
        }),
    )
    return c.json(result)
  } catch (err: unknown) {
    return jobError(c, err)
  }
}

export const pollShell: Handler = async (c) => {
  try {
    const input = pollSchema.parse(await c.req.json())
    return c.json(pollShellJob(input.jobId, input.sessionId, input.offset))
  } catch (err: unknown) {
    return jobError(c, err)
  }
}

export const streamShell: Handler = (c) => {
  let stream: ShellJobStream
  let maxBytes: number | undefined
  try {
    const parsed = streamSchema.parse({
      sessionId: c.req.query('sessionId'),
      jobId: c.req.query('jobId'),
      offset: c.req.query('offset'),
      maxBytes: c.req.query('maxBytes'),
    })
    maxBytes = parsed.maxBytes
    stream = subscribeShellJob(parsed.jobId, parsed.sessionId, parsed.offset)
  } catch (err: unknown) {
    return jobError(c, err)
  }
  return streamSSE(c, (sse) => pumpShellJobStream(sse, stream, maxBytes))
}

export const shellStdin: Handler = async (c) => {
  try {
    const input = stdinSchema.parse(await c.req.json())
    writeStdin(input.jobId, input.sessionId, input.data)
    return c.json({ ok: true })
  } catch (err: unknown) {
    return jobError(c, err)
  }
}

export const killShell: Handler = async (c) => {
  try {
    const input = killSchema.parse(await c.req.json())
    killShellJob(input.jobId, input.sessionId)
    return c.json({ ok: true })
  } catch (err: unknown) {
    return jobError(c, err)
  }
}

export const backgroundShell: Handler = async (c) => {
  try {
    const input = killSchema.parse(await c.req.json())
    backgroundShellJob(input.jobId, input.sessionId)
    return c.json({ ok: true })
  } catch (err: unknown) {
    return jobError(c, err)
  }
}

export const resizeShell: Handler = async (c) => {
  try {
    const input = resizeSchema.parse(await c.req.json())
    resizeShellJob(input.jobId, input.sessionId, input.cols, input.rows)
    return c.json({ ok: true })
  } catch (err: unknown) {
    return jobError(c, err)
  }
}

export const listShell: Handler = async (c) => {
  try {
    const input = sessionSchema.parse(await c.req.json())
    return c.json({ jobs: listShellJobs(input.sessionId) })
  } catch (err: unknown) {
    return jobError(c, err)
  }
}

export const killSessionShell: Handler = async (c) => {
  try {
    const input = killSessionSchema.parse(await c.req.json())
    const killed = killSessionShellJobs(
      input.sessionId,
      input.includeBackground ?? false,
      input.owner,
    )
    return c.json({ killed })
  } catch (err: unknown) {
    return jobError(c, err)
  }
}

function jobError(c: Context, err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  const status =
    err instanceof ZodError ? 400 : message.includes('not found') ? 404 : 500
  return c.json({ error: message }, status)
}
