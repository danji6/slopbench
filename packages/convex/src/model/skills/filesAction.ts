'use node'

import { SKILL_PAGE_SIZE } from '@sb/core/skills/types'
import type { AgentHome } from '@sb/core/skills/types'
import { errorMessage } from '@sb/core/utils/errors'

import { internal } from '../../_generated/api'
import type { Doc } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import type { OperationAttemptArgs, OperationResult } from '../../types'
import { postSidecar } from '../sidecar'
import type { ExecutionContext } from './execution'
import { importSkills } from './importAction'

type AgentContext = Extract<ExecutionContext, { agent: unknown }>

type HomeContext = Extract<ExecutionContext, { kind: 'home' | 'ensure' }>

type AssignmentContext = Extract<
  ExecutionContext,
  { kind: 'home' | 'ensure' | 'duplicate' }
>

type HomeReservation = { home: Doc<'agentHomes'>; joined: boolean }

/** Executes one claimed attempt using its atomically resolved resources. */
export async function run(ctx: ActionCtx, args: OperationAttemptArgs) {
  const data: ExecutionContext | null = await ctx.runMutation(
    internal.skills._claimExecution,
    args,
  )
  if (!data) return

  const token = `${Date.now() + 30 * 60_000}:${args.operationId}:${args.attempt}`
  const locked: string[] = []
  try {
    await lockResources(data, token, locked)
    const result = await execute(ctx, data, token, locked)
    if (!result) return
    const done = await ctx.runMutation(internal.skills._complete, {
      ...args,
      result,
    })
    if (done && data.kind === 'install') await deleteImportedUpload(ctx, data)
  } catch (cause) {
    await ctx.runMutation(internal.skills._fail, {
      ...args,
      message: errorMessage(cause) ?? 'Filesystem operation failed',
    })
  } finally {
    for (const agentId of locked) {
      await postSidecar('/agent-files/unlock', { agentId, token }).catch(
        () => {},
      )
    }
  }
}

async function lockResources(
  data: ExecutionContext,
  token: string,
  locked: string[],
) {
  const homes = 'home' in data ? [data.home._id] : []
  if (data.kind === 'duplicate') homes.push(data.destinationHome._id)
  for (const id of new Set(homes)) await lockHome(id, token, locked)
}

async function deleteImportedUpload(
  ctx: ActionCtx,
  data: Extract<ExecutionContext, { kind: 'install' }>,
) {
  const source = data.operation.source
  if (source.kind !== 'upload') return
  const upload = await ctx.runQuery(internal.skills._getUpload, {
    storageId: source.storageId,
  })
  const owned =
    upload?.ownerId === data.operation.ownerId &&
    upload.ticket === source.ticket
  if (owned)
    await ctx.runMutation(internal.skills._deleteUpload, {
      uploadId: upload._id,
    })
}

async function lockHome(id: string, token: string, locked: string[]) {
  if (locked.includes(id)) return
  await postSidecar('/agent-files/lock', { agentId: id, token })
  locked.push(id)
}

function operationBase(
  data: ExecutionContext,
  destinationHome?: Doc<'agentHomes'>,
) {
  const op = data.operation
  const home = 'home' in data ? data.home : undefined
  const destination =
    data.kind === 'duplicate' ? data.destinationHome : destinationHome
  return {
    id: op._id,
    ownerId: op.ownerId,
    agentId: 'agent' in data ? data.agent._id : home?.originAgentId,
    homeId: home?._id,
    homePath: home?.path,
    originAgentId: home?.originAgentId,
    destinationHomeId: destination?._id,
    destinationOriginAgentId: destination?.originAgentId,
    skillId: 'skill' in data ? data.skill._id : undefined,
    name: 'skill' in data ? data.skill.name : undefined,
  }
}

async function execute(
  ctx: ActionCtx,
  data: ExecutionContext,
  token: string,
  locked: string[],
): Promise<OperationResult | undefined> {
  switch (data.kind) {
    case 'delete-home':
      await deleteManagedHome(data)
      return { kind: data.kind }
    case 'detach':
      if (data.operation.removeFolder) await deleteManagedHome(data)
      return { kind: data.kind }
    case 'ensure':
    case 'home':
      return {
        kind: data.kind,
        ...(await changeHome(ctx, data, token, locked)),
      }
    case 'install':
      return (await importSkills(ctx, data)) ? { kind: data.kind } : undefined
    case 'duplicate':
      return { kind: data.kind, ...(await duplicateHome(ctx, data)) }
    case 'assign':
      await postSidecar('/agent-files/operation', {
        ...operationBase(data),
        kind: data.kind,
      })
      return { kind: data.kind, ...(await ensureHome(data)) }
    case 'delete-assigned':
    case 'delete-library':
      await postSidecar('/agent-files/operation', {
        ...operationBase(data),
        kind: data.kind,
      })
      return { kind: data.kind }
  }
}

async function deleteManagedHome(
  data: Extract<ExecutionContext, { kind: 'delete-home' | 'detach' }>,
) {
  if (!data.home.managed) throw new Error('Only managed homes may be removed')
  await postSidecar('/agent-files/operation', {
    ...operationBase(data),
    kind: 'delete-home',
  })
}

async function ensureHome(data: AgentContext) {
  const home = await postSidecar<AgentHome>('/agent-files/home', {
    ownerId: data.operation.ownerId,
    agentId: data.agent._id,
    path: data.home.path,
    homeId: data.home._id,
    originAgentId: data.home.originAgentId,
    revision: data.home.revision,
  })
  return { path: home.path }
}

async function changeHome(
  ctx: ActionCtx,
  data: HomeContext,
  token: string,
  locked: string[],
) {
  const op = data.operation

  const destination = await postSidecar<{ path: string; insideData: boolean }>(
    '/agent-files/destination',
    {
      ownerId: op.ownerId,
      agentId: op.agentId,
      path:
        data.kind === 'ensure' ? data.home.path : data.operation.destination,
      originAgentId:
        data.kind === 'ensure' ? data.home.originAgentId : undefined,
    },
  )

  const reserved: HomeReservation = await ctx.runMutation(
    internal.skills._reserveDestination,
    { operationId: op._id, attempt: op.attempt, ...destination },
  )

  await lockHome(reserved.home._id, token, locked)
  if (reserved.joined) return { path: destination.path }
  return publishHome(ctx, { data, home: reserved.home, path: destination.path })
}

type HomePublication = {
  data: HomeContext
  home: Doc<'agentHomes'>
  path: string
}

async function publishHome(
  ctx: ActionCtx,
  { data, home, path }: HomePublication,
) {
  const op = data.operation
  const base = operationBase(data, home)
  const copyFiles = data.kind === 'home' && data.operation.copyFiles

  const prepared = await postSidecar<{
    path: string
    unchanged: boolean
    sourceMissing: boolean
  }>('/agent-files/operation', {
    ...base,
    kind: 'prepare-home',
    destination: path,
    copyFiles,
  })

  const needsFreshSkills =
    !prepared.unchanged && (!copyFiles || prepared.sourceMissing)
  if (needsFreshSkills) await processAssignments(ctx, data, 'fresh')

  const result = await postSidecar<{ path: string }>('/agent-files/operation', {
    ...base,
    id: `${op._id}-publish`,
    kind: 'publish-home',
    homeOperationId: op._id,
  })

  if (!prepared.unchanged) await processAssignments(ctx, data, 'duplicate')

  return result
}

async function duplicateHome(
  ctx: ActionCtx,
  data: Extract<ExecutionContext, { kind: 'duplicate' }>,
) {
  const result = await postSidecar<{ path: string }>('/agent-files/operation', {
    ...operationBase(data),
    kind: 'duplicate',
    destination: data.duplicate._id,
  })
  await processAssignments(ctx, data, 'duplicate')
  return result
}

async function processAssignments(
  ctx: ActionCtx,
  data: AssignmentContext,
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
      agentId: data.agent._id,
      paginationOpts: { cursor, numItems: SKILL_PAGE_SIZE },
    })
    if (mode === 'duplicate') {
      await ctx.runMutation(internal.skills._copyAssignments, {
        operationId: op._id,
        attempt: op.attempt,
        ids: page.page.map((row) => row._id),
      })
    } else {
      await stageAssignments(data, page.page)
    }
    if (page.isDone) break
    cursor = page.continueCursor
  }
}

async function stageAssignments(
  data: AssignmentContext,
  rows: Doc<'agentSkills'>[],
) {
  const op = data.operation
  for (const row of rows) {
    await postSidecar('/agent-files/operation', {
      id: `${op._id}-${row._id}`,
      kind: 'stage-home-skill',
      ownerId: op.ownerId,
      agentId: data.agent._id,
      skillId: row.skillId,
      name: row.name,
      homeOperationId: op._id,
    })
  }
}
