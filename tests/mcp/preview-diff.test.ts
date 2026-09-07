import type * as Workspace from '@sb/sidecar/mcp/workspace/workspace'
/// <reference types="bun-types" />
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

type WorkspaceModule = typeof Workspace

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
  test('parent-relative grants enable external file tools, previews and undo', async () => {
    const { root, workspaceId } = await boundWorkspace('external-files')
    const external = await mkdtemp(path.join(tmpdir(), 'external-files-'))
    const filePath = path.join(external, 'file.txt')
    const args = { sessionId: 'external-files', workspaceId, filePath }
    const granted = { ...args, allowedPaths: [path.relative(root, external)] }
    try {
      await writeFile(filePath, 'original\n')
      await expect(workspaceModule.readWorkspaceFile(args)).rejects.toThrow(
        'escapes',
      )
      await expect(
        workspaceModule.writeWorkspaceFile({ ...args, content: 'blocked' }),
      ).rejects.toThrow('escapes')
      await expect(
        workspaceModule.editWorkspaceFile({
          ...args,
          edits: [{ oldText: 'original', newText: 'blocked' }],
        }),
      ).rejects.toThrow('escapes')
      expect(
        await workspaceModule.previewWorkspaceDiff({
          ...args,
          content: 'blocked',
        }),
      ).toEqual({ diff: '' })
      expect((await workspaceModule.readWorkspaceFile(granted)).path).toBe(
        filePath,
      )
      const preview = await workspaceModule.previewWorkspaceDiff({
        ...granted,
        content: 'changed\n',
      })
      expect(preview.path).toBe(filePath)
      expect(preview.diff).toContain('+changed')
      const write = await workspaceModule.writeWorkspaceFile({
        ...granted,
        content: 'changed\n',
      })
      expect(write.path).toBe(filePath)
      expect(write.diff).toBe(preview.diff)
      await workspaceModule.restoreLatestCheckpoint(args)
      expect(await readFile(filePath, 'utf8')).toBe('original\n')
      await workspaceModule.editWorkspaceFile({
        ...granted,
        edits: [{ oldText: 'original', newText: 'edited' }],
      })
      expect(await readFile(filePath, 'utf8')).toBe('edited\n')
      await workspaceModule.restoreLatestCheckpoint(args)
      expect(await readFile(filePath, 'utf8')).toBe('original\n')
      const newPath = path.join(external, 'new', 'created.txt')
      await workspaceModule.writeWorkspaceFile({
        ...granted,
        filePath: newPath,
        content: 'new',
      })
      await workspaceModule.restoreLatestCheckpoint(args)
      expect(await Bun.file(newPath).exists()).toBe(false)
      // Mentions never receive these grants.
      await expect(
        workspaceModule.resolveExistingPath(root, filePath),
      ).rejects.toThrow('escapes')
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(external, { recursive: true, force: true })
    }
  })

  test('checkpoint restore rejects a replaced external target symlink', async () => {
    const { root, workspaceId } = await boundWorkspace('external-symlink')
    const external = await mkdtemp(path.join(tmpdir(), 'external-checkpoint-'))
    const filePath = path.join(external, 'file.txt')
    const untouched = path.join(external, 'untouched.txt')
    try {
      await writeFile(filePath, 'original')
      await writeFile(untouched, 'untouched')
      await workspaceModule.writeWorkspaceFile({
        sessionId: 'external-symlink',
        workspaceId,
        filePath,
        content: 'changed',
        allowedPaths: [external],
      })
      await rm(filePath)
      await symlink(untouched, filePath)
      await expect(
        workspaceModule.restoreLatestCheckpoint({
          sessionId: 'external-symlink',
          workspaceId,
        }),
      ).rejects.toThrow('symlink')
      expect(await readFile(untouched, 'utf8')).toBe('untouched')
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(external, { recursive: true, force: true })
    }
  })

  test('workspace writes cannot follow a symlink past a directory grant', async () => {
    const { root, workspaceId } = await boundWorkspace('write-symlink')
    const external = await mkdtemp(path.join(tmpdir(), 'write-symlink-'))
    try {
      await mkdir(path.join(root, 'src'))
      await symlink(external, path.join(root, 'src', 'escape'))
      await expect(
        workspaceModule.writeWorkspaceFile({
          sessionId: 'write-symlink',
          workspaceId,
          filePath: 'src/escape/new.txt',
          content: 'blocked',
          allowedPaths: ['src'],
        }),
      ).rejects.toThrow('escapes')
      expect(await Bun.file(path.join(external, 'new.txt')).exists()).toBe(
        false,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(external, { recursive: true, force: true })
    }
  })
  test('the actual MCP route carries grants and literal checks to file tools', async () => {
    const { Hono } = await import('hono')
    const { handleMcpRequest } = await import('@sb/sidecar/mcp/mcp')
    const { callMcpTool } = await import('@sb/convex/model/tool/mcp')
    const { root, workspaceId } = await boundWorkspace('mcp-grants')
    const external = await mkdtemp(path.join(tmpdir(), 'mcp-external-'))
    const app = new Hono().all('/mcp', handleMcpRequest)
    const server = Bun.serve({ port: 0, fetch: app.fetch })
    const previous = process.env.SIDECAR_URL
    process.env.SIDECAR_URL = `http://localhost:${server.port}`
    const filePath = path.join(external, 'literal*.txt')
    const args = {
      sessionId: 'mcp-grants',
      workspaceId,
      allowedPaths: [external],
    }
    try {
      const checked = JSON.parse(
        await callMcpTool('check_paths', {
          ...args,
          paths: [filePath],
          literal: true,
        }),
      )
      expect(checked.complete).toBe(true)
      expect(checked.resolved[0].allowed).toBe(true)
      expect(checked.resolved[0].absolutePath).toBe(filePath)
      await callMcpTool('write_file', {
        ...args,
        path: filePath,
        content: 'first',
      })
      await callMcpTool('edit_file', {
        ...args,
        path: filePath,
        edits: [{ oldText: 'first', newText: 'second' }],
      })
      const read = JSON.parse(
        await callMcpTool('read_file', { ...args, path: filePath }),
      )
      expect(read.content).toBe('second')
      await expect(
        callMcpTool('read_file', {
          sessionId: args.sessionId,
          workspaceId,
          path: filePath,
        }),
      ).rejects.toThrow('escapes')
    } finally {
      server.stop(true)
      if (previous === undefined) delete process.env.SIDECAR_URL
      else process.env.SIDECAR_URL = previous
      await rm(root, { recursive: true, force: true })
      await rm(external, { recursive: true, force: true })
    }
  })
})
