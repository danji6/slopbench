import { evaluate } from '@sb/core/interpreter/evaluate'
import { createVariableStore } from '@sb/core/interpreter/store'
import type { EvalContext, JsonValue } from '@sb/core/interpreter/types'
import { mcpTransportSchema } from '@sb/core/types'
import { serve } from '@hono/node-server'
import { type Context, Hono } from 'hono'
import { ZodError, z } from 'zod'

import {
  exportAgent,
  exportAgentSchema,
  importAgentImage,
  importAgentSchema,
} from './io/agent'
import {
  pngImage,
  pngImageSchema,
  thumbnailImage,
  thumbnailImageSchema,
} from './io/image'
import { handleMcpRequest } from './mcp'
import { callExternalTool, listExternalTools } from './mcp/external/client'
import {
  bindWorkspace,
  bindWorkspaceSchema,
  clearWorkspace,
  clearWorkspaceSchema,
  listDirectories,
  listDirectoriesSchema,
  listWorkspaceFiles,
  listWorkspaceFilesByRoot,
  listWorkspaceFilesByRootSchema,
  listWorkspaceFilesSchema,
  previewDiffSchema,
  previewWorkspaceDiff,
  readWorkspaceFileLink,
  readWorkspaceFileLinkSchema,
  readWorkspaceInstructions,
  readWorkspaceInstructionsSchema,
  restoreCheckpointSchema,
  restoreLatestCheckpoint,
} from './mcp/workspace'
import { shellRoutes } from './shell/routes'

const PORT = Number(process.env.MCP_PORT ?? 3212)

const app = new Hono()

app.post('/mcp', handleMcpRequest)

const mcpConnectionSchema = z.object({
  url: z.string().url(),
  transport: mcpTransportSchema,
  apiKey: z.string().optional(),
})

const mcpListSchema = mcpConnectionSchema
const mcpCallSchema = mcpConnectionSchema.extend({
  name: z.string(),
  args: z.record(z.string(), z.unknown()).optional(),
})

app.post('/mcp-ext/list', async (c) => {
  try {
    const input = mcpListSchema.parse(await c.req.json())
    return c.json({ tools: await listExternalTools(input) })
  } catch (err: unknown) {
    return ioError(c, err)
  }
})

app.post('/mcp-ext/call', async (c) => {
  try {
    const { name, args, ...connection } = mcpCallSchema.parse(
      await c.req.json(),
    )
    const text = await callExternalTool(connection, name, args ?? {})
    return c.json({ text })
  } catch (err: unknown) {
    return ioError(c, err)
  }
})

app.route('/shell', shellRoutes)

app.post('/eval/prompts', async (c) => {
  try {
    const { items, context, environment } = (await c.req.json()) as {
      items: Record<string, unknown>[]
      context: EvalContext
      environment: Record<string, JsonValue>
    }
    const store = createVariableStore(environment ?? {})
    const renderedItems = items.map((item) => {
      if ('type' in item || !item.enabled) return item
      return {
        ...item,
        content: evaluate(item.content as string, context, store),
      }
    })
    return c.json({
      items: renderedItems,
      environment: store.toRecord(),
      dirty: store.isDirty(),
    })
  } catch (err: unknown) {
    return ioError(c, err)
  }
})

app.post('/eval/message', async (c) => {
  try {
    const { parts, context, environment } = (await c.req.json()) as {
      parts: Record<string, unknown>[]
      context: EvalContext
      environment: Record<string, JsonValue>
    }
    const store = createVariableStore(environment ?? {})
    const renderedParts = parts.map((part) =>
      part.type === 'text'
        ? { ...part, text: evaluate(part.text as string, context, store) }
        : part,
    )
    return c.json({
      parts: renderedParts,
      environment: store.toRecord(),
      dirty: store.isDirty(),
    })
  } catch (err: unknown) {
    return ioError(c, err)
  }
})

app.post('/io/agent/export', async (c) => {
  try {
    const input = exportAgentSchema.parse(await c.req.json())
    return c.json(await exportAgent(input))
  } catch (err: unknown) {
    return ioError(c, err)
  }
})

app.post('/io/agent/import', async (c) => {
  try {
    const input = importAgentSchema.parse(await c.req.json())
    return c.json(await importAgentImage(input))
  } catch (err: unknown) {
    return ioError(c, err)
  }
})

app.post('/io/image/thumbnail', async (c) => {
  try {
    const input = thumbnailImageSchema.parse(await c.req.json())
    return c.json(await thumbnailImage(input))
  } catch (err: unknown) {
    return ioError(c, err)
  }
})

app.post('/io/image/png', async (c) => {
  try {
    const input = pngImageSchema.parse(await c.req.json())
    return c.json(await pngImage(input))
  } catch (err: unknown) {
    return ioError(c, err)
  }
})

app.post('/workspace/bind', async (c) => {
  try {
    const input = bindWorkspaceSchema.parse(await c.req.json())
    return c.json(await bindWorkspace(input))
  } catch (err: unknown) {
    return ioError(c, err)
  }
})

app.post('/workspace/clear', async (c) => {
  try {
    const input = clearWorkspaceSchema.parse(await c.req.json())
    return c.json(await clearWorkspace(input))
  } catch (err: unknown) {
    return ioError(c, err)
  }
})

app.post('/workspace/list-directories', async (c) => {
  try {
    const input = listDirectoriesSchema.parse(await c.req.json())
    return c.json(await listDirectories(input))
  } catch (err: unknown) {
    return ioError(c, err)
  }
})

app.post('/workspace/list-files', async (c) => {
  try {
    const input = listWorkspaceFilesSchema.parse(await c.req.json())
    return c.json(await listWorkspaceFiles(input))
  } catch (err: unknown) {
    return ioError(c, err)
  }
})

app.post('/workspace/list-files-by-root', async (c) => {
  try {
    const input = listWorkspaceFilesByRootSchema.parse(await c.req.json())
    return c.json(await listWorkspaceFilesByRoot(input))
  } catch (err: unknown) {
    return ioError(c, err)
  }
})

app.post('/workspace/read-file', async (c) => {
  try {
    const input = readWorkspaceFileLinkSchema.parse(await c.req.json())
    return c.json(await readWorkspaceFileLink(input))
  } catch (err: unknown) {
    return ioError(c, err)
  }
})

app.post('/workspace/instructions', async (c) => {
  try {
    const input = readWorkspaceInstructionsSchema.parse(await c.req.json())
    return c.json(await readWorkspaceInstructions(input))
  } catch (err: unknown) {
    return ioError(c, err)
  }
})

app.post('/workspace/restore-latest', async (c) => {
  try {
    const input = restoreCheckpointSchema.parse(await c.req.json())
    return c.json(await restoreLatestCheckpoint(input))
  } catch (err: unknown) {
    return ioError(c, err)
  }
})

app.post('/workspace/preview-diff', async (c) => {
  try {
    const input = previewDiffSchema.parse(await c.req.json())
    return c.json(await previewWorkspaceDiff(input))
  } catch (err: unknown) {
    return ioError(c, err)
  }
})

app.notFound((c) => c.text('Not found', 404))

serve({
  fetch: app.fetch,
  hostname: '127.0.0.1',
  port: PORT,
})

console.log(`Local server running on http://localhost:${PORT}`)

function ioError(c: Context, err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  const status = err instanceof ZodError ? 400 : 500
  console.error('Error handling I/O request:', err)
  return c.json({ error: message }, status)
}
