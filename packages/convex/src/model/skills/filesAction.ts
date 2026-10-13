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
import { importSource } from './uploadAction'

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
  const attempt = await ctx.runMutation(internal.skills._running, { operationId }) // prettier-ignore
  if (!attempt) return
  data.operation.attempt = attempt

  const op = data.operation
  const token = `${Date.now() + 30 * 60_000}:${operationId}:${attempt}`
  const locked: string[] = []
  try {
    const duplicate = op.duplicateId
      ? await ctx.runQuery(internal.skills._agent, { agentId: op.duplicateId })
      : null
    for (const id of [
      op.homeId ?? op.agentId,
      duplicate?.homeId ?? op.duplicateId,
    ]) {
      if (!id) continue
      await postSidecar('/agent-files/lock', { agentId: id, token })
      locked.push(id)
    }

    const result = await execute(ctx, data, token, locked)
    if (!result) return

    await ctx.runMutation(internal.skills._complete, {
      operationId,
      attempt,
      ...result,
    })

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
      attempt,
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
    agentId: op.agentId ?? data.home?.originAgentId,
    homeId: op.homeId,
    destinationHomeId: data.destinationHome?._id,
    destinationOriginAgentId: data.destinationHome?.originAgentId,
    originAgentId: data.home?.originAgentId,
    homePath: data.home?.path ?? agent?.homePath,
    skillId: op.skillId,
    name: skill?.name,
  }
}

async function execute(
  ctx: ActionCtx,
  data: OperationContext,
  token: string,
  locked: string[],
): Promise<OperationResult | undefined> {
  switch (data.operation.kind) {
    case 'delete-home':
      if (!data.home?.managed)
        throw new Error('Only managed homes may be removed')
      await postSidecar('/agent-files/operation', {
        ...operationBase(data),
        kind: 'delete-home',
      })
      return {}
    case 'detach':
      if (data.operation.removeFolder) {
        if (!data.home?.managed)
          throw new Error('Only managed homes may be removed')
        await postSidecar('/agent-files/operation', {
          ...operationBase(data),
          kind: 'delete-home',
        })
      }
      return { previousPath: data.home?.path }
    case 'ensure':
      return changeHome(ctx, data, token, locked)
    case 'install':
      return data.operation.skillId && data.operation.importCursor === undefined
        ? installLibrarySkill(ctx, data)
        : importSkills(ctx, data)
    case 'home':
      return changeHome(ctx, data, token, locked)
    case 'duplicate':
      return duplicateHome(ctx, data)
    default:
      await postSidecar('/agent-files/operation', {
        ...operationBase(data),
        kind: data.operation.kind,
      })
      return data.operation.agentId ? ensureHome(ctx, data) : {}
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
    homeId: op.homeId,
    destinationHomeId: data.destinationHome?._id,
    destinationOriginAgentId: data.destinationHome?.originAgentId,
    originAgentId: data.home?.originAgentId,
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
  const metadata = await postSidecar<SkillMetadata>('/agent-files/operation', {
    ...base,
    kind: 'install',
    ...(await importSource(ctx, op)),
  })

  return { metadata }
}

async function changeHome(
  ctx: ActionCtx,
  data: OperationContext,
  token: string,
  locked: string[],
): Promise<OperationResult> {
  const { operation: op, agent } = data

  const destination = await postSidecar<{ path: string; insideData: boolean }>(
    '/agent-files/destination',
    {
      ownerId: op.ownerId,
      agentId: op.agentId,
      path: op.kind === 'ensure' ? data.home?.path : op.destination,
      originAgentId:
        op.kind === 'ensure' ? data.home?.originAgentId : undefined,
    },
  )

  const reserved = await ctx.runMutation(internal.skills._reserveDestination, {
    operationId: op._id,
    attempt: op.attempt,
    ...destination,
  })

  data.destinationHome = reserved.home

  if (!locked.includes(reserved.home._id)) {
    await postSidecar('/agent-files/lock', {
      agentId: reserved.home._id,
      token,
    })
    locked.push(reserved.home._id)
  }

  if (reserved.joined)
    return { path: destination.path, previousPath: agent?.resolvedHomePath }

  const base = operationBase(data)

  const prepared = await postSidecar<{
    path: string
    unchanged: boolean
    sourceMissing: boolean
  }>('/agent-files/operation', {
    ...base,
    kind: 'prepare-home',
    destination: destination.path,
    copyFiles: op.copyFiles,
  })

  if (!prepared.unchanged) {
    if (!op.copyFiles || prepared.sourceMissing)
      await processAssignments(ctx, data, 'fresh')
    await processAssignments(ctx, data, 'duplicate')
  }

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
        attempt: op.attempt,
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
