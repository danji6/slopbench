import { serve } from '@hono/node-server'
import { mcpTransportSchema } from '@sb/core/types'
import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'

import { lockAgent, unlockAgent } from './agent-files/access'
import { skillMetadata } from './agent-files/catalog'
import { desktopCapability, openHomeFolder } from './agent-files/desktop'
import { resolveDestination } from './agent-files/destination'
import { inspectHome } from './agent-files/home-state'
import { importPage } from './agent-files/import-discovery'
import { homeInfo, runFileOperation } from './agent-files/operations'
import {
  agentLockSchema,
  catalogSchema,
  homeSchema,
  importPageSchema,
  operationSchema,
  uploadProofSchema,
} from './agent-files/schemas'
import { verifySkillUpload } from './agent-files/upload'
import { sidecarAuthentication } from './auth'
import { messageSchema, promptsSchema } from './eval/schemas'
import { evaluateMessage, evaluatePrompts } from './eval/service'
import { ioError, sidecarError } from './http-errors'
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
  restoreCheckpointSchema,
  restoreLatestCheckpoint,
} from './mcp/workspace'
import {
  lockSchema,
  lockWorkspaces,
  unlockWorkspaces,
  validateSources,
  validateSourcesSchema,
} from './mcp/workspace/context'
import { shellRoutes } from './shell/routes'
import { updateStatus } from './update/status'

const PORT = Number(process.env.MCP_PORT ?? 3212)

export function createApp(authenticate: MiddlewareHandler) {
  const app = new Hono()
  app.get('/health', (c) => c.json({ ready: true }))
  app.use('*', authenticate)

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
      const { value: tools, transport } = await listExternalTools(input)
      return c.json({ tools, transport })
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

  app.post('/eval/prompts', async (c) =>
    c.json(await evaluatePrompts(promptsSchema.parse(await c.req.json()))),
  )

  app.post('/eval/message', async (c) =>
    c.json(await evaluateMessage(messageSchema.parse(await c.req.json()))),
  )

  app.post('/agent-files/home', async (c) =>
    c.json(await homeInfo(homeSchema.parse(await c.req.json()))),
  )

  app.post('/agent-files/status', async (c) =>
    c.json(await inspectHome(homeSchema.parse(await c.req.json()))),
  )

  app.post('/agent-files/destination', async (c) =>
    c.json(await resolveDestination(homeSchema.parse(await c.req.json()))),
  )

  app.get('/agent-files/desktop', (c) => c.json(desktopCapability()))

  app.post('/agent-files/open', async (c) =>
    c.json(await openHomeFolder(homeSchema.parse(await c.req.json()))),
  )

  app.post('/agent-files/operation', async (c) =>
    c.json(await runFileOperation(operationSchema.parse(await c.req.json()))),
  )

  app.post('/agent-files/metadata', async (c) =>
    c.json(await skillMetadata(catalogSchema.parse(await c.req.json()))),
  )

  app.post('/agent-files/lock', async (c) => {
    const input = agentLockSchema.parse(await c.req.json())
    await lockAgent(input.agentId, input.token)
    return c.json({ ok: true })
  })

  app.post('/agent-files/unlock', async (c) => {
    const input = agentLockSchema.parse(await c.req.json())
    unlockAgent(input.agentId, input.token)
    return c.json({ ok: true })
  })

  app.post('/agent-files/verify-upload', async (c) => {
    const input = uploadProofSchema.parse(await c.req.json())
    return c.json({
      verified: await verifySkillUpload(input.fileUrl, input.ticket),
    })
  })

  app.post('/agent-files/import-page', async (c) => {
    const input = importPageSchema.parse(await c.req.json())
    return c.json(await importPage(input.id, input.cursor))
  })
  app.onError(sidecarError)

  app.get('/update/status', async (c) => {
    try {
      return c.json(await updateStatus())
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

  app.post('/workspace/validate-sources', async (c) => {
    try {
      return c.json(
        await validateSources(validateSourcesSchema.parse(await c.req.json())),
      )
    } catch (err) {
      return ioError(c, err)
    }
  })

  app.post('/workspace/lock', async (c) => {
    try {
      return c.json(await lockWorkspaces(lockSchema.parse(await c.req.json())))
    } catch (err) {
      return ioError(c, err)
    }
  })

  app.post('/workspace/unlock', async (c) => {
    try {
      return c.json(unlockWorkspaces(lockSchema.parse(await c.req.json())))
    } catch (err) {
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

  return app
}

if (import.meta.main) {
  const app = createApp(sidecarAuthentication(process.env.SIDECAR_SECRET))
  serve({ fetch: app.fetch, hostname: '127.0.0.1', port: PORT })
  console.log(`Local server running on http://localhost:${PORT}`)
}
