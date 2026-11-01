import type { ActionCtx } from '@sb/convex/_generated/server'
import { restoreChanges } from '@sb/convex/actions/session/changes'
import { expect, test } from 'bun:test'
import { getFunctionName } from 'convex/server'

function fixture(paths?: readonly string[], failure?: string) {
  const requests: Record<string, unknown>[] = []
  const results: Record<string, unknown>[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push((await request.json()) as Record<string, unknown>)
      if (failure) return Response.json({ error: failure }, { status: 409 })
      return Response.json({
        summary: {
          state: 'reverted',
          revision: 1,
          issues: ['Skipped locked.txt'],
        },
        conflicts: [],
      })
    },
  })
  const previous = process.env.SIDECAR_URL
  process.env.SIDECAR_URL = `http://127.0.0.1:${server.port}`
  const workspace = {
    workspaceId: 'workspace',
    path: '/project',
    label: 'Project',
    sources: [{ id: 'primary', path: '/project', label: 'Project' }],
  }
  const args = { changeSetId: 'changes' as never, operationId: 'revert' }
  const ctx = {
    async runQuery(reference: Parameters<typeof getFunctionName>[0]) {
      switch (getFunctionName(reference)) {
        case 'chat:_getChangeSet':
          return {
            _id: args.changeSetId,
            sessionId: 'session',
            operationId: args.operationId,
            direction: 'revert',
            revision: 0,
          }
        case 'chat:_changesRestoreContext':
          return { workspace, agents: [] }
        case 'sessions:_getApprovals':
          return { paths }
        default:
          throw new Error(`Unexpected query: ${getFunctionName(reference)}`)
      }
    },
    async runMutation(
      reference: Parameters<typeof getFunctionName>[0],
      result: Record<string, unknown>,
    ) {
      expect(getFunctionName(reference)).toBe('chat:_restoreChangesResult')
      results.push(result)
    },
  } as unknown as ActionCtx
  return {
    requests,
    results,
    run: () => restoreChanges(ctx, args),
    close() {
      server.stop(true)
      if (previous === undefined) delete process.env.SIDECAR_URL
      else process.env.SIDECAR_URL = previous
    },
  }
}

test.each([
  {
    name: 'sends an empty grant list when no paths were approved',
    paths: undefined,
  },
  {
    name: 'preserves explicitly approved paths',
    paths: ['/approved/file.txt'],
  },
])('$name', async ({ paths }) => {
  const f = fixture(paths)
  try {
    await f.run()
    expect(f.requests).toHaveLength(1)
    expect(f.requests[0].allowedPaths).toEqual(paths ?? [])
    expect(f.results[0]).toMatchObject({
      state: 'reverted',
      revision: 1,
      conflicts: [],
      issues: ['Skipped locked.txt'],
    })
  } finally {
    f.close()
  }
})

test('publishes the restore failure message without its serialized error envelope', async () => {
  const message =
    'Wait for workspace writers to finish before restoring changes'
  const f = fixture(undefined, message)
  try {
    await f.run()
    expect(f.results[0].error).toBe(message)
  } finally {
    f.close()
  }
})
