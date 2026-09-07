import { mergeToolApprovals } from '@sb/convex/lib/tool/approval'
import type { WorkspaceToolContext } from '@sb/convex/model/tool/context'
import {
  createEditFileTool,
  createReadFileTool,
  createWriteFileTool,
} from '@sb/convex/model/tool/files'
import { createShellTool } from '@sb/convex/model/tool/shellTools'
import type { ToolApprovals } from '@sb/core/types'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { startPathSidecar } from '../helpers/path-sidecar'

let sidecar: Awaited<ReturnType<typeof startPathSidecar>>
let live: ToolApprovals = {}
let plan = false
const context = {
  sessionId: 'path-session',
  ownerId: 'path-session',
  workspaceId: 'workspace',
  approvals: async () => live,
  isPlanMode: async () => plan,
} as WorkspaceToolContext

async function needs(tool: unknown, input: unknown) {
  return (
    tool as { needsApproval: (input: unknown) => Promise<boolean> }
  ).needsApproval(input)
}

describe('tool path approvals', () => {
  beforeAll(async () => {
    sidecar = await startPathSidecar()
  })
  afterAll(async () => {
    await sidecar.close()
  })

  test('file edits use combined grants while unmatched files retain tool approvals', async () => {
    const write = await createWriteFileTool(context)
    live = mergeToolApprovals({ paths: ['from-session'] }, { paths: ['src'] })!
    expect(await needs(write, { path: 'src/file.txt' })).toBe(false)
    expect(await needs(write, { path: 'from-session/new.txt' })).toBe(false)
    expect(await needs(write, { path: 'other/new.txt' })).toBe(true)
    live = { tools: ['write_file'] }
    expect(await needs(write, { path: 'other/new.txt' })).toBe(false)
    expect(
      await needs(await createReadFileTool(context), { path: 'src/file.txt' }),
    ).toBe(false)
  })

  test('all file tools honor explicit .git grants', async () => {
    for (const tool of await Promise.all([
      createReadFileTool(context),
      createWriteFileTool(context),
      createEditFileTool(context),
    ])) {
      live = { paths: ['.'], tools: ['write_file'] }
      expect(await needs(tool, { path: '.git/config' })).toBe(true)
      live = { paths: ['.git/config'] }
      expect(await needs(tool, { path: '.git/config' })).toBe(false)
      expect(await needs(tool, { path: '.git/HEAD' })).toBe(true)
    }
  })

  test('external access is independent from blanket tool approval', async () => {
    const read = await createReadFileTool(context)
    live = { tools: ['write_file'] }
    expect(await needs(read, { path: '/tmp/external-fixture/new' })).toBe(true)
    live = { paths: ['/tmp/external-fixture'] }
    expect(await needs(read, { path: '/tmp/external-fixture/new' })).toBe(false)
  })

  test('parent-relative grants cover file tools and shell paths independently', async () => {
    live = { paths: ['../project_2'] }
    for (const tool of await Promise.all([
      createReadFileTool(context),
      createWriteFileTool(context),
      createEditFileTool(context),
    ])) {
      expect(await needs(tool, { path: '../project_2/new.txt' })).toBe(false)
      expect(await needs(tool, { path: '../project_2-cache/new.txt' })).toBe(
        true,
      )
    }
    const shell = await createShellTool(context)
    expect(await needs(shell, { command: 'cat ../project_2/new.txt' })).toBe(
      false,
    )
    expect(
      await needs(shell, { command: 'git checkout ../project_2/new.txt' }),
    ).toBe(true)
    live.shell = ['git checkout']
    expect(
      await needs(shell, { command: 'git checkout ../project_2/new.txt' }),
    ).toBe(false)
  })

  test('shell commands still need independent approval and complete analysis', async () => {
    const shell = await createShellTool(context)
    live = { paths: ['.git', '/tmp/external-fixture'] }
    expect(await needs(shell, { command: 'cat .git/config' })).toBe(false)
    expect(
      await needs(shell, { command: 'cat /tmp/external-fixture/new' }),
    ).toBe(false)
    expect(
      await needs(shell, { command: 'rm /tmp/external-fixture/new' }),
    ).toBe(true)
    live.shell = ['rm', 'git checkout']
    expect(
      await needs(shell, { command: 'rm /tmp/external-fixture/new' }),
    ).toBe(true) // Unknown operand semantics stay gated.
    expect(
      await needs(shell, { command: 'git checkout /tmp/external-fixture/new' }),
    ).toBe(false)
    expect(await needs(shell, { command: 'cat $(pwd)/file' })).toBe(true)
    expect(
      await needs(shell, {
        command: 'cat /tmp/external-fixture/new > /tmp/output',
      }),
    ).toBe(true)
    expect(await needs(shell, { command: 'cat "$HOME/file"' })).toBe(true)
    live = { paths: ['.'] }
    expect(await needs(shell, { command: 'cat .git/config' })).toBe(true)
  })

  test('plan mode blocks edits even with path grants or unrestricted approval', async () => {
    plan = true
    try {
      const write = await createWriteFileTool(context)
      for (const approvals of [
        { paths: ['src'] },
        { mode: 'unrestricted' as const },
      ]) {
        live = approvals
        await expect(
          write.execute!({ path: 'src/new', content: 'new' }, {} as never),
        ).rejects.toThrow('Plan mode')
      }
      live = { paths: ['/tmp/external-fixture'], shell: ['rm'] }
      expect(
        await needs(await createShellTool(context), {
          command: 'rm /tmp/external-fixture/new',
        }),
      ).toBe(true)
    } finally {
      plan = false
    }
  })

  test('execution forwards current grants without exposing them to the model', async () => {
    const write = await createWriteFileTool(context)
    live = { paths: ['src'] }
    expect(await needs(write, { path: 'src/new' })).toBe(false)
    live = { paths: ['changed'] }
    await write.execute!({ path: 'src/new', content: 'new' }, {} as never)
    expect(sidecar.requests.at(-1)?.arguments.allowedPaths).toEqual(['changed'])
    const schema = write.inputSchema as unknown as {
      shape: Record<string, unknown>
    }
    expect(schema.shape).not.toHaveProperty('allowedPaths')
  })

  test('sidecar failures cannot establish a grant', async () => {
    sidecar.setAvailable(false)
    try {
      live = { paths: ['.'], tools: ['write_file'] }
      expect(
        await needs(await createWriteFileTool(context), { path: 'src/new' }),
      ).toBe(true)
      expect(
        await needs(await createShellTool(context), {
          command: 'cat src/file.txt',
        }),
      ).toBe(true)
    } finally {
      sidecar.setAvailable(true)
    }
  })
})
