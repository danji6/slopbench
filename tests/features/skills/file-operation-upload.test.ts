import type { Id } from '@sb/convex/_generated/dataModel'
import type { ActionCtx } from '@sb/convex/_generated/server'
import { complete, fail } from '@sb/convex/model/skills/completion'
import { claimExecution } from '@sb/convex/model/skills/execution'
import { run } from '@sb/convex/model/skills/filesAction'
import {
  continueImport,
  finish,
  prepare,
} from '@sb/convex/model/skills/imports'
import { start } from '@sb/convex/model/skills/operations'
import { expect, test } from 'bun:test'
import { getFunctionName } from 'convex/server'
import { skillsDatabase } from '~/tests/helpers/skills-db'

const storageId = 'upload' as Id<'_storage'>

function uploadAction(f: ReturnType<typeof skillsDatabase>) {
  const handlers = {
    'skills:_claimExecution': claimExecution,
    'skills:_prepareImportSkill': prepare,
    'skills:_finishImportSkill': finish,
    'skills:_continueImport': continueImport,
    'skills:_complete': complete,
    'skills:_fail': fail,
    'skills:_deleteUpload': async (
      _ctx: unknown,
      args: { uploadId: Id<'skillUploads'> },
    ) => f.ctx.db.delete(args.uploadId),
  }
  const runMutation = async (
    reference: Parameters<typeof getFunctionName>[0],
    args: unknown,
  ) => {
    const name = getFunctionName(reference)
    const handler = handlers[name as keyof typeof handlers]
    if (!handler) throw new Error(`Unexpected upload callback: ${name}`)
    return (handler as (ctx: typeof f.ctx, args: unknown) => Promise<unknown>)(
      f.ctx,
      args,
    )
  }
  return {
    runMutation,
    runQuery: async () => f.rows('skillUploads')[0],
    storage: { getUrl: async () => 'http://fixture/upload.zip' },
  } as unknown as ActionCtx
}

test.each([true, false])(
  'uploaded import retains retry authority when copying succeeds: %s',
  async (succeeds) => {
    const f = skillsDatabase()
    f.rows('skillUploads').push({
      _id: 'staged',
      ownerId: 'owner',
      storageId,
      ticket: 'ticket',
      verified: true,
    })
    const operationId = await start(f.ctx, { kind: 'install', storageId })
    const previousFetch = globalThis.fetch
    const previousSecret = process.env.SIDECAR_SECRET
    process.env.SIDECAR_SECRET = 'fixture-secret'
    const metadata = { name: 'uploaded-skill', description: 'Uploaded skill' }
    globalThis.fetch = (async (input, init) => {
      const route = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body))
      if (route === '/agent-files/import-page')
        return Response.json({
          entries: [{ metadata, path: '/upload/skill', nextCursor: 1 }],
          nextCursor: 1,
          isDone: true,
        })
      if (route === '/agent-files/operation' && body.kind === 'install')
        return Response.json({
          ...metadata,
          name: succeeds ? metadata.name : 'changed-name',
        })
      return Response.json({})
    }) as typeof fetch
    try {
      await run(uploadAction(f), { operationId, attempt: 1 })
      expect((await f.ctx.db.get(operationId))?.state.phase).toBe(
        succeeds ? 'done' : 'failed',
      )
      expect(f.rows('skillUploads')).toHaveLength(succeeds ? 0 : 1)
      expect(f.rows('skills')[0]).toHaveProperty(
        'status',
        succeeds ? 'ready' : 'failed',
      )
    } finally {
      globalThis.fetch = previousFetch
      if (previousSecret === undefined) delete process.env.SIDECAR_SECRET
      else process.env.SIDECAR_SECRET = previousSecret
    }
  },
)
