import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {
  TOOL_DESCRIPTIONS,
  editFileFields,
  readFileFields,
  webFetchQuerySchema,
  webSearchSchema,
  writeFileFields,
} from '@sb/core/types'
import type { Context } from 'hono'
import { z } from 'zod'

import { fetchWeb } from './fetch/web_fetch'
import { searchWeb } from './web_search'
import { workspaceContextSchema } from './workspace/context'
import {
  checkFlaggedPaths,
  editWorkspaceFile,
  readWorkspaceFile,
  runWorkspaceCommand,
  writeWorkspaceFile,
} from './workspace/workspace'

export async function handleMcpRequest(c: Context): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  const server = buildMcpServer()

  try {
    await server.connect(transport)
    return await transport.handleRequest(c.req.raw)
  } catch (err: unknown) {
    console.error('Error handling MCP request:', err)
    return c.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      },
      500,
    )
  } finally {
    await transport.close()
    await server.close()
  }
}

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'chat-tools', version: '1.0.0' })

  server.registerTool(
    'web_fetch',
    {
      description: TOOL_DESCRIPTIONS.web_fetch,
      inputSchema: webFetchQuerySchema.shape,
    },
    async (input, { signal }) => {
      const result = await fetchWeb(input, signal)
      return { content: [{ type: 'text' as const, text: formatJson(result) }] }
    },
  )

  server.registerTool(
    'web_search',
    {
      description: TOOL_DESCRIPTIONS.web_search,
      inputSchema: webSearchSchema.shape,
    },
    async (input, { signal }) => {
      const result = await searchWeb(input, signal)
      return { content: [{ type: 'text' as const, text: formatJson(result) }] }
    },
  )

  const workspaceFields = {
    sessionId: z.string(),
    workspaceId: z.string(),
    workspace: workspaceContextSchema,
  }

  server.registerTool(
    'read_file',
    {
      description: TOOL_DESCRIPTIONS.read_file,
      inputSchema: z.strictObject({
        ...workspaceFields,
        ...readFileFields,
        allowedPaths: z.array(z.string()).optional(),
      }),
    },
    async ({
      sessionId,
      workspaceId,
      workspace,
      path,
      offset,
      limit,
      byteOffset,
      allowedPaths,
    }) => {
      const result = await readWorkspaceFile({
        sessionId,
        workspaceId,
        workspace,
        filePath: path,
        allowedPaths,
        offset,
        limit,
        byteOffset,
      })
      return { content: [{ type: 'text' as const, text: formatJson(result) }] }
    },
  )

  server.registerTool(
    'write_file',
    {
      description: TOOL_DESCRIPTIONS.write_file,
      inputSchema: z.strictObject({
        ...workspaceFields,
        ...writeFileFields,
        allowedPaths: z.array(z.string()).optional(),
      }),
    },
    async ({
      sessionId,
      workspaceId,
      workspace,
      path,
      content,
      allowedPaths,
    }) => {
      const result = await writeWorkspaceFile({
        sessionId,
        workspaceId,
        workspace,
        filePath: path,
        allowedPaths,
        content,
      })
      return { content: [{ type: 'text' as const, text: formatJson(result) }] }
    },
  )

  server.registerTool(
    'edit_file',
    {
      description: TOOL_DESCRIPTIONS.edit_file,
      inputSchema: z.strictObject({
        ...workspaceFields,
        ...editFileFields,
        allowedPaths: z.array(z.string()).optional(),
      }),
    },
    async ({
      sessionId,
      workspaceId,
      workspace,
      path,
      edits,
      allowedPaths,
    }) => {
      const result = await editWorkspaceFile({
        sessionId,
        workspaceId,
        workspace,
        filePath: path,
        allowedPaths,
        edits,
      })
      return { content: [{ type: 'text' as const, text: formatJson(result) }] }
    },
  )

  server.registerTool(
    'shell',
    {
      description:
        'Run a (bash) shell command in the configured session workspace and return stdout/stderr.',
      inputSchema: z.strictObject({
        ...workspaceFields,
        command: z.string(),
        cwd: z.string().optional(),
        allowedPaths: z.array(z.string()).optional(),
        timeout: z.number().optional(),
      }),
    },
    async ({
      sessionId,
      workspaceId,
      workspace,
      command,
      cwd,
      allowedPaths,
      timeout,
    }) => {
      const result = await runWorkspaceCommand({
        sessionId,
        workspaceId,
        workspace,
        command,
        cwd,
        allowedPaths,
        timeout,
      })
      return { content: [{ type: 'text' as const, text: result.output }] }
    },
  )

  server.registerTool(
    'check_paths',
    {
      description:
        'Report which of the given paths are sensitive (git-ignored or outside the workspace). Globs are expanded.',
      inputSchema: z.strictObject({
        ...workspaceFields,
        paths: z.array(z.string()),
        allowedPaths: z.array(z.string()).optional(),
        literal: z.boolean().optional(),
        cwd: z.string().optional(),
      }),
    },
    async ({
      sessionId,
      workspaceId,
      workspace,
      paths,
      allowedPaths,
      literal,
      cwd,
    }) => {
      const result = await checkFlaggedPaths({
        sessionId,
        workspaceId,
        workspace,
        paths,
        allowedPaths,
        literal,
        cwd,
      })
      return { content: [{ type: 'text' as const, text: formatJson(result) }] }
    },
  )

  return server
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}
