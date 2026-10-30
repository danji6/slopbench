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
import { workspaceCheckpoint } from '~/tests/helpers/workspace-checkpoints'

type WorkspaceModule = typeof Workspace

let workspaceModule: WorkspaceModule
let dataDir: string
const previousDataDir = process.env.CHAT_SIDECAR_DATA_DIR

async function boundWorkspace(sessionId: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'chat-workspace-'))
  const workspace = {
    workspaceId: sessionId,
    path: root,
    label: sessionId,
    sources: [{ id: 'primary', path: root, label: sessionId }],
  }
  return { root, workspaceId: workspace.workspaceId, workspace }
}

describe('previewWorkspaceDiff', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'chat-sidecar-'))
    process.env.CHAT_SIDECAR_DATA_DIR = dataDir
    workspaceModule = await import('@sb/sidecar/mcp/workspace/workspace')
  })

  afterAll(async () => {
    if (previousDataDir === undefined) delete process.env.CHAT_SIDECAR_DATA_DIR
    else process.env.CHAT_SIDECAR_DATA_DIR = previousDataDir
    await rm(dataDir, { recursive: true, force: true })
  })

  test('turn checkpoint routes capture real file tools and reject later conflicts', async () => {
    const { Hono } = await import('hono')
    const { checkpointRoutes } = await import('@sb/sidecar/checkpoints/routes')
    const { root, workspaceId, workspace } = await boundWorkspace('turn-routes')
    const app = new Hono().route('/checkpoints', checkpointRoutes)
    const request = (endpoint: string, body: unknown) =>
      app.request(`/checkpoints/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const context = { sessionId: 'turn-routes', workspaceId, workspace }
    try {
      await writeFile(path.join(root, 'file.txt'), 'original\n')
      expect(
        (
          await request('begin', {
            ...context,
            groupId: 'route-group',
            participantId: 'route-parent',
            root: true,
          })
        ).ok,
      ).toBe(true)
      await workspaceModule.writeWorkspaceFile({
        ...context,
        filePath: 'file.txt',
        content: 'changed\n',
      })
      await workspaceModule.writeWorkspaceFile({
        ...context,
        filePath: 'new.txt',
        content: 'new\n',
      })
      const response = await request('finish', {
        groupId: 'route-group',
        participantId: 'route-parent',
        checkpointId: 'route-turn',
        root: true,
      })
      const result = await response.json()
      expect(result.publication.files).toHaveLength(2)
      const restore = {
        ...context,
        checkpointId: 'route-turn',
        operationId: 'route-undo',
        revision: 0,
        direction: 'revert',
        allowedPaths: [],
      }
      await writeFile(path.join(root, 'file.txt'), 'manual\n')
      expect(
        (await (await request('restore', restore)).json()).conflicts,
      ).toEqual(['file.txt'])
      expect(await readFile(path.join(root, 'new.txt'), 'utf8')).toBe('new\n')
      await writeFile(path.join(root, 'file.txt'), 'changed\n')
      expect(
        (await (await request('restore', restore)).json()).summary.state,
      ).toBe('reverted')
      expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe(
        'original\n',
      )
    } finally {
      await request('remove-session', { sessionId: context.sessionId })
      await rm(root, { recursive: true, force: true })
    }
  })

  test('builds a positioned unified diff for an edit', async () => {
    const { root, workspaceId, workspace } =
      await boundWorkspace('preview-edit')
    await writeFile(path.join(root, 'file.txt'), 'a\nb\nc\nd\ne\nf\n', 'utf-8')

    const { diff } = await workspaceModule.previewWorkspaceDiff({
      sessionId: 'preview-edit',
      workspaceId,
      workspace,
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
    const { root, workspaceId, workspace } =
      await boundWorkspace('preview-write')
    await writeFile(path.join(root, 'greet.txt'), 'hello\nworld\n', 'utf-8')

    const { diff } = await workspaceModule.previewWorkspaceDiff({
      sessionId: 'preview-write',
      workspaceId,
      workspace,
      filePath: 'greet.txt',
      content: 'hello\nthere\nworld\n',
    })

    expect(diff).toContain('@@ ')
    expect(diff).toContain('\n+there\n')

    await rm(root, { recursive: true, force: true })
  })

  test('returns an empty diff when the edit cannot be applied', async () => {
    const { root, workspaceId, workspace } =
      await boundWorkspace('preview-miss')
    await writeFile(path.join(root, 'file.txt'), 'alpha\nbeta\n', 'utf-8')

    const { diff } = await workspaceModule.previewWorkspaceDiff({
      sessionId: 'preview-miss',
      workspaceId,
      workspace,
      filePath: 'file.txt',
      edits: [{ oldText: 'not-present\n', newText: 'x\n' }],
    })

    expect(diff).toBe('')

    await rm(root, { recursive: true, force: true })
  })
  test('parent-relative grants enable external file tools, previews and undo', async () => {
    const { root, workspaceId, workspace } =
      await boundWorkspace('external-files')
    const external = await mkdtemp(path.join(tmpdir(), 'external-files-'))
    const filePath = path.join(external, 'file.txt')
    const args = {
      sessionId: 'external-files',
      workspaceId,
      workspace,
      filePath,
    }
    const granted = { ...args, allowedPaths: [path.relative(root, external)] }
    const capture = await workspaceCheckpoint(args)
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
      await workspaceModule.editWorkspaceFile({
        ...granted,
        edits: [{ oldText: 'changed', newText: 'edited' }],
      })
      expect(await readFile(filePath, 'utf8')).toBe('edited\n')
      const newPath = path.join(external, 'new', 'created.txt')
      await workspaceModule.writeWorkspaceFile({
        ...granted,
        filePath: newPath,
        content: 'new',
      })
      await capture.finish()
      await expect(capture.restore()).rejects.toThrow('escapes')
      await capture.restore({ allowedPaths: granted.allowedPaths })
      expect(await readFile(filePath, 'utf8')).toBe('original\n')
      expect(await Bun.file(newPath).exists()).toBe(false)
      await capture.restore({
        allowedPaths: granted.allowedPaths,
        direction: 'reapply',
        revision: 1,
      })
      expect(await readFile(filePath, 'utf8')).toBe('edited\n')
      expect(await readFile(newPath, 'utf8')).toBe('new')
      // Mentions never receive these grants.
      await expect(
        workspaceModule.resolveExistingPath(root, filePath),
      ).rejects.toThrow('escapes')
    } finally {
      await capture.cleanup()
      await rm(root, { recursive: true, force: true })
      await rm(external, { recursive: true, force: true })
    }
  })

  test('checkpoint restore rejects a replaced external target symlink', async () => {
    const { root, workspaceId, workspace } =
      await boundWorkspace('external-symlink')
    const external = await mkdtemp(path.join(tmpdir(), 'external-checkpoint-'))
    const filePath = path.join(external, 'file.txt')
    const untouched = path.join(external, 'untouched.txt')
    const capture = await workspaceCheckpoint({
      sessionId: 'external-symlink',
      workspace,
    })
    try {
      await writeFile(filePath, 'original')
      await writeFile(untouched, 'untouched')
      await workspaceModule.writeWorkspaceFile({
        sessionId: 'external-symlink',
        workspaceId,
        workspace,
        filePath,
        content: 'changed',
        allowedPaths: [external],
      })
      await capture.finish()
      await rm(filePath)
      await symlink(untouched, filePath)
      await expect(
        capture.restore({ allowedPaths: [external] }),
      ).rejects.toThrow('symlink')
      expect(await readFile(untouched, 'utf8')).toBe('untouched')
    } finally {
      await capture.cleanup()
      await rm(root, { recursive: true, force: true })
      await rm(external, { recursive: true, force: true })
    }
  })

  test('workspace writes cannot follow a symlink past a directory grant', async () => {
    const { root, workspaceId, workspace } =
      await boundWorkspace('write-symlink')
    const external = await mkdtemp(path.join(tmpdir(), 'write-symlink-'))
    try {
      await mkdir(path.join(root, 'src'))
      await symlink(external, path.join(root, 'src', 'escape'))
      await expect(
        workspaceModule.writeWorkspaceFile({
          sessionId: 'write-symlink',
          workspaceId,
          workspace,
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
    const { root, workspaceId, workspace } = await boundWorkspace('mcp-grants')
    const external = await mkdtemp(path.join(tmpdir(), 'mcp-external-'))
    const app = new Hono().all('/mcp', handleMcpRequest)
    const server = Bun.serve({ port: 0, fetch: app.fetch })
    const previous = process.env.SIDECAR_URL
    process.env.SIDECAR_URL = `http://localhost:${server.port}`
    const filePath = path.join(external, 'literal*.txt')
    const args = {
      sessionId: 'mcp-grants',
      workspaceId,
      workspace,
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
          workspace,
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
  test('multiple sources keep relative paths primary and allow absolute secondary paths', async () => {
    const { root, workspaceId, workspace } =
      await boundWorkspace('multi-source')
    const secondary = await mkdtemp(path.join(tmpdir(), 'chat-secondary-'))
    let capture: Awaited<ReturnType<typeof workspaceCheckpoint>> | undefined
    try {
      workspace.sources.push({
        id: 'secondary',
        path: secondary,
        label: 'secondary',
      })
      await writeFile(path.join(root, 'same.txt'), 'primary')
      await writeFile(path.join(secondary, 'same.txt'), 'secondary')
      const input = { sessionId: 'multi-source', workspaceId, workspace }
      expect(
        (
          await workspaceModule.readWorkspaceFile({
            ...input,
            filePath: 'same.txt',
          })
        ).content,
      ).toBe('primary')
      expect(
        (
          await workspaceModule.readWorkspaceFile({
            ...input,
            filePath: path.join(secondary, 'same.txt'),
          })
        ).content,
      ).toBe('secondary')
      const { listWorkspaceFiles } =
        await import('@sb/sidecar/mcp/workspace/files')
      expect((await listWorkspaceFiles(input)).files.sort()).toEqual(
        [path.join(secondary, 'same.txt'), 'same.txt'].sort(),
      )
      capture = await workspaceCheckpoint(input)
      await workspaceModule.writeWorkspaceFile({
        ...input,
        filePath: path.join(secondary, 'same.txt'),
        content: 'edited',
      })
      await capture.finish()
      workspace.sources.pop()
      await expect(capture.restore()).rejects.toThrow()
      expect(await readFile(path.join(secondary, 'same.txt'), 'utf8')).toBe(
        'edited',
      )
      workspace.sources.push({
        id: 'secondary',
        path: secondary,
        label: 'secondary',
      })
      await capture.restore()
      expect(await readFile(path.join(secondary, 'same.txt'), 'utf8')).toBe(
        'secondary',
      )
      await rm(root, { recursive: true, force: true })
      await expect(
        workspaceModule.readWorkspaceFile({ ...input, filePath: 'same.txt' }),
      ).rejects.toThrow()
    } finally {
      await capture?.cleanup()
      await rm(root, { recursive: true, force: true })
      await rm(secondary, { recursive: true, force: true })
    }
  })

  test('source roots do not grant access to escaping symlinks or git internals', async () => {
    const { root, workspaceId, workspace } =
      await boundWorkspace('source-boundaries')
    const outside = await mkdtemp(path.join(tmpdir(), 'chat-outside-'))
    try {
      await writeFile(path.join(outside, 'secret.txt'), 'outside')
      await symlink(outside, path.join(root, 'escape'))
      await mkdir(path.join(root, '.git'))
      await writeFile(path.join(root, '.git/config'), 'private')
      const input = { sessionId: 'source-boundaries', workspaceId, workspace }
      await expect(
        workspaceModule.readWorkspaceFile({
          ...input,
          filePath: 'escape/secret.txt',
        }),
      ).rejects.toThrow()
      const { checkPaths } =
        await import('@sb/sidecar/mcp/workspace/check-paths')
      const checked = await checkPaths(
        root,
        { paths: ['.git/config'], literal: true },
        [root],
      )
      expect(checked.uncovered).toEqual(['.git/config'])
      expect(checked.resolved[0]).toMatchObject({
        forbidden: true,
        allowed: false,
      })
      expect(await readFile(path.join(root, '.git/config'), 'utf8')).toBe(
        'private',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  test('deduplicates canonical sources and overlapping file listings', async () => {
    const { root, workspaceId, workspace } = await boundWorkspace('overlap')
    try {
      const child = path.join(root, 'child')
      await mkdir(child)
      await writeFile(path.join(child, 'file.txt'), 'text')
      const { validateSources } =
        await import('@sb/sidecar/mcp/workspace/context')
      workspace.sources.push(
        { id: 'duplicate', path: root + '/.', label: 'duplicate' },
        { id: 'child', path: child, label: 'child' },
      )
      workspace.sources = await validateSources({ sources: workspace.sources })
      expect(workspace.sources).toHaveLength(2)
      const { listWorkspaceFiles } =
        await import('@sb/sidecar/mcp/workspace/files')
      expect(
        (
          await listWorkspaceFiles({
            sessionId: 'overlap',
            workspaceId,
            workspace,
          })
        ).files,
      ).toEqual(['child/file.txt'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('source transitions reject in-flight operations and fence new operations until unlocked', async () => {
    const { lockWorkspaces, unlockWorkspaces, withWorkspaceOperation } =
      await import('@sb/sidecar/mcp/workspace/context')
    const input = {
      sessionIds: ['locked-session'],
      token: `${Date.now() + 60000}:test`,
    }
    let release!: () => void
    const pending = withWorkspaceOperation(
      'locked-session',
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    await expect(lockWorkspaces(input)).rejects.toThrow('Wait for shell jobs')
    release()
    await pending
    await lockWorkspaces(input)
    await expect(
      withWorkspaceOperation('locked-session', async () => true),
    ).rejects.toThrow('sources are being updated')
    unlockWorkspaces({ ...input, token: 'wrong' })
    await expect(
      withWorkspaceOperation('locked-session', async () => true),
    ).rejects.toThrow()
    unlockWorkspaces(input)
    expect(
      await withWorkspaceOperation('locked-session', async () => true),
    ).toBe(true)
  })
})
