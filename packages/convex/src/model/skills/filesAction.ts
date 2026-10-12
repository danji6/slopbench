'use node'

import { SKILL_PAGE_SIZE } from '@sb/core/skills/types'
import type { AgentHome, SkillMetadata } from '@sb/core/skills/types'
import { errorMessage } from '@sb/core/utils/errors'

import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { postSidecar } from '../sidecar'
import { importSkills } from './importAction'
import type { OperationContext } from './operations'

/** Executes durable filesystem work and reconciles its result with Convex. */
export async function run(
  ctx: ActionCtx,
  operationId: Id<'agentFileOperations'>,
) {
  const data: OperationContext | null = await ctx.runQuery(
    internal.skills._getOperation,
    { operationId },
  )

  if (!data || data.operation.status === 'done') return
  if (!(await ctx.runMutation(internal.skills._running, { operationId }))) return // prettier-ignore

  const op = data.operation
  const token = `${Date.now() + 30 * 60_000}:${operationId}`
  const locked: string[] = []
  try {
    for (const id of [op.agentId, op.duplicateId]) {
      if (!id) continue
      await postSidecar('/agent-files/lock', { agentId: id, token })
      locked.push(id)
    }

    const result = await execute(ctx, data)
    if (!result) return

    await ctx.runMutation(internal.skills._complete, { operationId, ...result })

    const completed =
      op.kind === 'install' && op.storageId
        ? await ctx.runQuery(internal.skills._getOperation, { operationId })
        : null

    if (
      op.kind === 'install' &&
      op.storageId &&
      completed?.operation.status === 'done'
    ) {
      const upload = await ctx.runQuery(internal.skills._getUpload, {
        storageId: op.storageId,
      })
      if (upload?.ownerId === op.ownerId) {
        await ctx.runMutation(internal.skills._deleteUpload, {
          uploadId: upload._id,
        })
      }
    }
  } catch (error) {
    await ctx.runMutation(internal.skills._fail, {
      operationId,
      message: errorMessage(error) ?? 'Filesystem operation failed',
    })
  } finally {
    for (const agentId of locked)
      await postSidecar('/agent-files/unlock', { agentId, token }).catch(
        () => {},
      )
  }
}

type OperationResult = {
  path?: string
  previousPath?: string
  metadata?: SkillMetadata
}

function operationBase(data: OperationContext) {
  const { operation: op, agent, skill } = data
  return {
    id: op._id,
    ownerId: op.ownerId,
    agentId: op.agentId,
    homePath: agent?.homePath,
    skillId: op.skillId,
    name: skill?.name,
  }
}

async function execute(
  ctx: ActionCtx,
  data: OperationContext,
): Promise<OperationResult | undefined> {
  switch (data.operation.kind) {
    case 'ensure':
      return ensureHome(ctx, data)
    case 'install':
      return data.operation.skillId && data.operation.importCursor === undefined
        ? installLibrarySkill(ctx, data)
        : importSkills(ctx, data)
    case 'home':
      return changeHome(ctx, data)
    case 'duplicate':
      return duplicateHome(ctx, data)
    default:
      await postSidecar('/agent-files/operation', {
        ...operationBase(data),
        kind: data.operation.kind,
      })
      return {}
  }
}

async function ensureHome(
  _ctx: ActionCtx,
  data: OperationContext,
): Promise<OperationResult> {
  const { operation: op, agent } = data
  const home = await postSidecar<AgentHome>('/agent-files/home', {
    ownerId: op.ownerId,
    agentId: op.agentId,
    path: agent?.homePath,
    revision: agent?.homeRevision ?? 0,
  })
  return { path: home.path }
}

async function installLibrarySkill(
  ctx: ActionCtx,
  data: OperationContext,
): Promise<OperationResult> {
  const { operation: op } = data
  const base = operationBase(data)
  const fileUrl = op.storageId
    ? await ctx.storage.getUrl(op.storageId)
    : undefined

  const upload = op.storageId
    ? await ctx.runQuery(internal.skills._getUpload, {
        storageId: op.storageId,
      })
    : null
  if (upload && upload.ownerId !== op.ownerId)
    throw new Error('Skill upload not found')

  if (fileUrl && op.uploadTicket && !upload?.verified) {
    const proof = await postSidecar<{ verified: boolean }>(
      '/agent-files/verify-upload',
      { fileUrl, ticket: op.uploadTicket },
    )
    if (!proof.verified)
      throw new Error('Skill upload does not belong to this import')
    if (upload) {
      await ctx.runMutation(internal.skills._verifyUpload, {
        uploadId: upload._id,
      })
    }
  }

  const metadata = await postSidecar<SkillMetadata>('/agent-files/operation', {
    ...base,
    kind: 'install',
    source: op.source,
    fileUrl,
    ticket: op.uploadTicket,
  })

  return { metadata }
}

async function changeHome(
  ctx: ActionCtx,
  data: OperationContext,
): Promise<OperationResult> {
  const { operation: op, agent } = data
  const base = operationBase(data)

  const prepared = await postSidecar<{ path: string; unchanged: boolean }>(
    '/agent-files/operation',
    {
      ...base,
      kind: 'prepare-home',
      destination: op.destination,
      copyFiles: op.copyFiles,
    },
  )

  await validateDestination(ctx, data, prepared.path)

  if (!prepared.unchanged && !op.copyFiles)
    await processAssignments(ctx, data, 'fresh')

  const result = await postSidecar<{ path: string }>('/agent-files/operation', {
    ...base,
    id: `${op._id}-publish`,
    kind: 'publish-home',
    homeOperationId: op._id,
  })

  return { ...result, previousPath: agent?.resolvedHomePath }
}

async function duplicateHome(
  ctx: ActionCtx,
  data: OperationContext,
): Promise<OperationResult> {
  const { operation: op } = data
  const base = operationBase(data)
  const result = await postSidecar<{ path: string }>('/agent-files/operation', {
    ...base,
    kind: 'duplicate',
    destination: op.duplicateId,
  })
  await processAssignments(ctx, data, 'duplicate')
  return result
}

async function processAssignments(
  ctx: ActionCtx,
  data: OperationContext,
  mode: 'fresh' | 'duplicate',
) {
  const op = data.operation
  let cursor: string | null = null
  while (true) {
    const page: {
      page: Doc<'agentSkills'>[]
      continueCursor: string
      isDone: boolean
    } = await ctx.runQuery(internal.skills._assignments, {
      agentId: op.agentId!,
      paginationOpts: { cursor, numItems: SKILL_PAGE_SIZE },
    })
    if (mode === 'duplicate') {
      await ctx.runMutation(internal.skills._copyAssignments, {
        operationId: op._id,
        ids: page.page.map((row) => row._id),
      })
    } else {
      for (const row of page.page) {
        await postSidecar('/agent-files/operation', {
          id: `${op._id}-${row._id}`,
          kind: 'stage-home-skill',
          ownerId: op.ownerId,
          agentId: op.agentId,
          skillId: row.skillId,
          name: row.name,
          homeOperationId: op._id,
        })
      }
    }
    if (page.isDone) {
      break
    }
    cursor = page.continueCursor
  }
}

async function validateDestination(
  ctx: ActionCtx,
  data: OperationContext,
  destination: string,
) {
  await ctx.runMutation(internal.skills._reserveDestination, {
    operationId: data.operation._id,
    path: destination,
  })
}
