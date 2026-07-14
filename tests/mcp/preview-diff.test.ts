/// <reference types="bun-types" />
import type {
  bindWorkspace,
  previewWorkspaceDiff,
} from '@sb/sidecar/mcp/workspace/workspace'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

type WorkspaceModule = {
  bindWorkspace: typeof bindWorkspace
  previewWorkspaceDiff: typeof previewWorkspaceDiff
}

let workspaceModule: WorkspaceModule
let dataDir: string

async function boundWorkspace(sessionId: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'chat-workspace-'))
  const workspace = await workspaceModule.bindWorkspace({ sessionId, root })
  return { root, workspaceId: workspace.workspaceId }
}

describe('previewWorkspaceDiff', () => {
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

  test('builds a positioned unified diff for an edit', async () => {
    const { root, workspaceId } = await boundWorkspace('preview-edit')
    await writeFile(path.join(root, 'file.txt'), 'a\nb\nc\nd\ne\nf\n', 'utf-8')

    const { diff } = await workspaceModule.previewWorkspaceDiff({
      sessionId: 'preview-edit',
      workspaceId,
      filePath: 'file.txt',
      edits: [{ oldText: 'c\n', newText: 'C\n' }],
    })

    expect(diff.startsWith('--- file.txt\n+++ file.txt\n@@ ')).toBe(true)
    // Line 3 changed, with context lines around it.
    expect(diff).toContain('@@ -1,6 +1,6 @@')
    expect(diff).toContain('\n-c\n')
    expect(diff).toContain('\n+C\n')

    await rm(root, { recursive: true, force: true })
  })

  test('diffs new content against the existing file for a write', async () => {
    const { root, workspaceId } = await boundWorkspace('preview-write')
    await writeFile(path.join(root, 'greet.txt'), 'hello\nworld\n', 'utf-8')

    const { diff } = await workspaceModule.previewWorkspaceDiff({
      sessionId: 'preview-write',
      workspaceId,
      filePath: 'greet.txt',
      content: 'hello\nthere\nworld\n',
    })

    expect(diff).toContain('@@ ')
    expect(diff).toContain('\n+there\n')

    await rm(root, { recursive: true, force: true })
  })

  test('returns an empty diff when the edit cannot be applied', async () => {
    const { root, workspaceId } = await boundWorkspace('preview-miss')
    await writeFile(path.join(root, 'file.txt'), 'alpha\nbeta\n', 'utf-8')

    const { diff } = await workspaceModule.previewWorkspaceDiff({
      sessionId: 'preview-miss',
      workspaceId,
      filePath: 'file.txt',
      edits: [{ oldText: 'not-present\n', newText: 'x\n' }],
    })

    expect(diff).toBe('')

    await rm(root, { recursive: true, force: true })
  })
})
