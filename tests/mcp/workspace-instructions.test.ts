/// <reference types="bun-types" />
import type {
  bindWorkspace,
  readWorkspaceInstructions,
} from '@sb/sidecar/mcp/workspace/workspace'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

type WorkspaceModule = {
  bindWorkspace: typeof bindWorkspace
  readWorkspaceInstructions: typeof readWorkspaceInstructions
}

let workspaceModule: WorkspaceModule
let dataDir: string

describe('workspace instructions', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'chat-sidecar-'))
    process.env.CHAT_SIDECAR_DATA_DIR = dataDir
    process.env.CHAT_WORKSPACE_STORE = path.join(dataDir, 'workspaces.json')
    process.env.CHAT_WORKSPACE_CHECKPOINTS = path.join(dataDir, 'checkpoints')
    workspaceModule = await import('@sb/sidecar/mcp/workspace/workspace')
  })

  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  test('reads AGENTS.md from the workspace root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'chat-workspace-'))
    await writeFile(path.join(root, 'AGENTS.md'), 'Use bun.\n', 'utf-8')

    const workspace = await workspaceModule.bindWorkspace({
      sessionId: 'session-with-agents',
      root,
    })

    await expect(
      workspaceModule.readWorkspaceInstructions({
        sessionId: 'session-with-agents',
        workspaceId: workspace.workspaceId,
      }),
    ).resolves.toEqual({
      path: 'AGENTS.md',
      content: 'Use bun.\n',
      truncated: false,
    })

    await rm(root, { recursive: true, force: true })
  })

  test('returns null when AGENTS.md is missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'chat-workspace-'))
    const workspace = await workspaceModule.bindWorkspace({
      sessionId: 'session-without-agents',
      root,
    })

    await expect(
      workspaceModule.readWorkspaceInstructions({
        sessionId: 'session-without-agents',
        workspaceId: workspace.workspaceId,
      }),
    ).resolves.toBeNull()

    await rm(root, { recursive: true, force: true })
  })
})
