import { serve } from '@hono/node-server'
import { Hono, type MiddlewareHandler } from 'hono'

import { lockAgent, unlockAgent } from './agent-files/access'
import { skillMetadata } from './agent-files/catalog'
import { desktopCapability, openHomeFolder } from './agent-files/desktop'
import { resolveDestination } from './agent-files/destination'
import { inspectHome } from './agent-files/home-state'
import { importPage } from './agent-files/import-discovery'
import { homeInfo, runFileOperation } from './agent-files/operations'
import {
  projectCatalogSchema,
  projectSkillCatalog,
} from './agent-files/project-catalog'
import {
  agentLockSchema,
  catalogSchema,
  homeSchema,
  importPageSchema,
  operationSchema,
  uploadProofSchema,
  verifyLibrarySchema,
} from './agent-files/schemas'
import { verifySkillUpload } from './agent-files/upload'
import { verifyLibrary } from './agent-files/verify-library'
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
import { externalMcpRoutes } from './mcp/external/handlers'
import { drainMcpOperations } from './mcp/external/operation-routes'
import { mcpRegistry } from './mcp/external/registry'
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
import {
  cancelChatGPTSignIn,
  chatGPTHost,
  chatGPTModels,
  chatGPTResponses,
  chatGPTStatus,
  disconnectChatGPT,
  prepareChatGPTTransfer,
  startChatGPTSignIn,
} from './providers/openai/handlers'
import {
  backgroundShell,
  killSessionShell,
  killShell,
  listShell,
  pollShell,
  resizeShell,
  shellInfo,
  shellStdin,
  startShell,
  streamShell,
} from './shell/handlers'
import { updateStatus } from './update/status'

const PORT = Number(process.env.MCP_PORT ?? 3212)

export function createApp(authenticate: MiddlewareHandler) {
  const app = new Hono()
  app.get('/health', (c) => c.json({ ready: true }))
  app.use('*', authenticate)

  app.post('/providers/chatgpt/prepare-transfer', prepareChatGPTTransfer)
  app.post('/providers/chatgpt/start', startChatGPTSignIn)
  app.post('/providers/chatgpt/status', chatGPTStatus)
  app.post('/providers/chatgpt/cancel', cancelChatGPTSignIn)
  app.post('/providers/chatgpt/host', chatGPTHost)
  app.post('/providers/chatgpt/disconnect', disconnectChatGPT)
  app.post('/providers/chatgpt/models', chatGPTModels)
  app.post('/providers/chatgpt/responses', chatGPTResponses)

  app.post('/mcp', handleMcpRequest)

  app.route('/mcp-ext', externalMcpRoutes())

  app.get('/shell/info', shellInfo)
  app.post('/shell/start', startShell)
  app.post('/shell/poll', pollShell)
  app.get('/shell/stream', streamShell)
  app.post('/shell/stdin', shellStdin)
  app.post('/shell/kill', killShell)
  app.post('/shell/background', backgroundShell)
  app.post('/shell/resize', resizeShell)
  app.post('/shell/list', listShell)
  app.post('/shell/kill_session', killSessionShell)

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

  app.post('/agent-files/project-catalog', async (c) =>
    c.json(
      await projectSkillCatalog(projectCatalogSchema.parse(await c.req.json())),
    ),
  )

  app.post('/agent-files/verify-library', async (c) =>
    c.json(await verifyLibrary(verifyLibrarySchema.parse(await c.req.json()))),
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
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: PORT })
  let shuttingDown = false
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (shuttingDown) return
      shuttingDown = true
      void mcpRegistry
        .close()
        .then(drainMcpOperations)
        .then(
          () => server.close(() => process.exit(0)),
          () => {
            console.error('MCP shutdown cleanup failed')
            server.close(() => process.exit(1))
          },
        )
    })
  }
  console.log(`Local server running on http://localhost:${PORT}`)
}
