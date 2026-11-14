import { Hono } from 'hono'
import { z } from 'zod'

import { checkpoints } from '../checkpoints/manager'
import { withWorkspaceOperation } from '../mcp/workspace/context'
import { duplicateDirectory, removeDirectory } from './lifecycle'
import { assertSessionDirectoryLive, sessionFilePath } from './storage'
import {
  commitCopy,
  publishSnapshot,
  removeTransfer,
  rollbackCopy,
  stageCopy,
  uploadedSnapshot,
} from './transfers'

const transfer = z.object({
  sessionId: z.string(),
  operationId: z.string(),
  path: z.string(),
})

const copy = transfer.extend({
  url: z.url(),
  byteLength: z.number().int().nonnegative(),
})

const publish = transfer.extend({
  url: z.url(),
  filename: z.string().optional(),
})

const operation = transfer.pick({ operationId: true })

const pending = new Set<string>()

async function exclusive<T>(id: string, action: () => Promise<T>) {
  if (pending.has(id))
    throw new Error('Session file operation is still running')
  pending.add(id)
  try {
    return await action()
  } finally {
    pending.delete(id)
  }
}

const duplications = new Map<string, ReturnType<typeof duplicateDirectory>>()

async function duplicateOnce(input: Parameters<typeof duplicateDirectory>[0]) {
  const existing = duplications.get(input.targetId)
  if (existing) return existing

  const duplicate = exclusive(`duplicate:${input.targetId}`, () =>
    duplicateDirectory(input),
  )
  duplications.set(input.targetId, duplicate)
  try {
    await duplicate
  } finally {
    duplications.delete(input.targetId)
  }
}

function activeSession<T>(id: string, action: () => Promise<T>) {
  return withWorkspaceOperation(id, async () => {
    await assertSessionDirectoryLive(id)
    return action()
  })
}

export function sessionFileRoutes() {
  const app = new Hono()

  app.post('/stage-copy', async (c) => {
    const input = copy.parse(await c.req.json())
    await exclusive(input.operationId, () =>
      activeSession(input.sessionId, () => stageCopy(input, c.req.raw.signal)),
    )
    return c.json({ ok: true })
  })

  app.post('/commit-copy', async (c) => {
    const input = transfer.parse(await c.req.json())
    await exclusive(input.operationId, () =>
      activeSession(input.sessionId, () =>
        checkpoints().write(input.sessionId, undefined, async () => {
          await checkpoints().trackFile(
            input.sessionId,
            sessionFilePath(input.sessionId, input.path),
          )
          await commitCopy(input)
        }),
      ),
    )
    return c.json({ ok: true })
  })

  app.post('/publish', async (c) => {
    const input = publish.parse(await c.req.json())
    return c.json(
      await exclusive(input.operationId, () =>
        activeSession(input.sessionId, () =>
          publishSnapshot(input, c.req.raw.signal),
        ),
      ),
    )
  })

  app.post('/cleanup-transfer', async (c) => {
    const input = operation
      .extend({
        rollback: transfer.optional(),
        discardUpload: z.boolean(),
      })
      .parse(await c.req.json())
    return c.json(
      await exclusive(input.operationId, async () => {
        if (input.rollback) await rollbackCopy(input.rollback)
        const upload = input.discardUpload
          ? await uploadedSnapshot(input.operationId)
          : undefined
        if (!upload) await removeTransfer(input.operationId)
        return { storageId: upload?.storageId }
      }),
    )
  })

  app.post('/duplicate', async (c) => {
    const input = z
      .object({
        sourceId: z.string(),
        targetId: z.string(),
        sessionIds: z.array(z.string()),
        token: z.string(),
      })
      .parse(await c.req.json())
    await duplicateOnce(input)
    return c.json({ ok: true })
  })

  app.post('/delete', async (c) => {
    const input = z.object({ sessionId: z.string() }).parse(await c.req.json())
    await exclusive(`duplicate:${input.sessionId}`, () =>
      removeDirectory(input.sessionId),
    )
    return c.json({ ok: true })
  })
  return app
}
