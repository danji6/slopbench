import { Hono } from 'hono'
import { z } from 'zod'

import { ioError } from '../http-errors'
import {
  withFilesystemOperation,
  workspaceContextSchema,
} from '../mcp/workspace/context'
import { checkpoints } from './manager'

const beginSchema = z.object({
  root: z.boolean().optional(),
  groupId: z.string(),
  participantId: z.string(),
  sessionId: z.string(),
  workspace: workspaceContextSchema,
})

const finishSchema = z.object({
  groupId: z.string(),
  participantId: z.string(),
  checkpointId: z.string(),
  root: z.boolean(),
  pendingParticipants: z.array(z.string()).optional(),
})

const restoreSchema = z.object({
  checkpointId: z.string(),
  sessionId: z.string(),
  operationId: z.string(),
  revision: z.number().int().nonnegative(),
  direction: z.enum(['revert', 'reapply']),
  workspace: workspaceContextSchema,
  workspaces: z.array(workspaceContextSchema).optional(),
  allowedPaths: z.array(z.string()),
})

export const checkpointRoutes = new Hono()
  .post('/begin', async (c) => {
    try {
      const input = beginSchema.parse(await c.req.json())
      return c.json(
        await withFilesystemOperation(input, () => checkpoints().begin(input)),
      )
    } catch (error) {
      return ioError(c, error)
    }
  })
  .post('/finish', async (c) => {
    try {
      return c.json(
        await checkpoints().finish(finishSchema.parse(await c.req.json())),
      )
    } catch (error) {
      return ioError(c, error)
    }
  })
  .post('/settle', async (c) => {
    try {
      const input = z
        .object({ groupId: z.string(), checkpointId: z.string() })
        .parse(await c.req.json())
      return c.json(
        await checkpoints().settle(input.groupId, input.checkpointId),
      )
    } catch (error) {
      return ioError(c, error)
    }
  })
  .post('/restore', async (c) => {
    try {
      const input = restoreSchema.parse(await c.req.json())
      return c.json(
        await withRestoreScopes(input, () => checkpoints().restore(input)),
      )
    } catch (error) {
      return ioError(c, error)
    }
  })
  .post('/remove-session', async (c) => {
    try {
      const { sessionId } = z
        .object({ sessionId: z.string() })
        .parse(await c.req.json())
      await checkpoints().removeSession(sessionId)
      return c.json({ ok: true })
    } catch (error) {
      return ioError(c, error)
    }
  })

/** Holds every participating home against relocation throughout restore and recovery. */
function withRestoreScopes<T>(
  input: z.infer<typeof restoreSchema>,
  operation: () => Promise<T>,
) {
  const scopes = [input.workspace, ...(input.workspaces ?? [])]
  const run = (index: number): Promise<T> => {
    const workspace = scopes[index]
    return workspace
      ? withFilesystemOperation({ sessionId: input.sessionId, workspace }, () =>
          run(index + 1),
        )
      : operation()
  }
  return run(0)
}
