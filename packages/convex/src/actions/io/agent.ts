'use node'

import { api, internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { error } from '../../errors'
import { getSubject } from '../../functions'
import {
  agentArchiveToCreateArgs,
  createAgentArchive,
} from '../../model/agent/archive'
import { postSidecar } from '../../model/sidecar'
import type { Prompt } from '../../types'
import { generateAvatarThumbnail } from './avatar'

export async function exportAsImage(
  ctx: ActionCtx,
  { agentId }: { agentId: Id<'agents'> },
): Promise<{ type: 'png' | 'json'; data: string; name: string }> {
  const agent = await ctx.runQuery(api.agents.get, { agentId })
  if (!agent) error('Agent not found', 404)

  const { _id, _creationTime, ownerId: _ownerId, avatarId, ...data } = agent

  const settings = await ctx.runQuery(api.settings.get, {})

  const archive = createAgentArchive(
    data,
    (settings?.libraryPrompts ?? []) as Prompt[],
  )

  const urls = avatarId
    ? await ctx.runQuery(api.avatars.getUrls, { avatarId })
    : null

  const result = await postSidecar<{ type: 'png' | 'json'; data: string }>(
    '/io/agent/export',
    { avatarUrl: urls?.original ?? undefined, data: archive },
  )

  return { ...result, name: agent.name }
}

export async function importFromImage(
  ctx: ActionCtx,
  { storageId }: { storageId: Id<'_storage'> },
): Promise<Id<'agents'>> {
  await getSubject(ctx)

  const fileUrl = await ctx.storage.getUrl(storageId)
  if (!fileUrl) error('File not found', 404)

  const uploadUrl = await ctx.storage.generateUploadUrl()

  const { data, avatarStorageId } = await postSidecar<{
    data: unknown
    avatarStorageId: Id<'_storage'>
  }>('/io/agent/import', { fileUrl, uploadUrl })

  await ctx.storage.delete(storageId)

  const agentId = await ctx.runMutation(
    api.agents.create,
    agentArchiveToCreateArgs(data),
  )

  let thumbStorageId: Id<'_storage'> | undefined
  try {
    thumbStorageId = await generateAvatarThumbnail(ctx, avatarStorageId)

    const avatarId = await ctx.runMutation(internal.avatars._create, {
      storageId: avatarStorageId,
      thumbStorageId,
    })

    await ctx.runMutation(api.agents.confirmAvatarUpload, { agentId, avatarId })
  } catch (err) {
    await ctx.storage.delete(avatarStorageId).catch(() => {})

    if (thumbStorageId) {
      await ctx.storage.delete(thumbStorageId).catch(() => {})
    }

    throw err
  }
  return agentId
}
