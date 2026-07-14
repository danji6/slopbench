import { useActiveAgent } from '@/hooks/chat/agent'
import type { ActiveAgent } from '@/hooks/chat/agent'
import { useUserProfile } from '@/hooks/chat/profile'
import { useActiveSession } from '@/hooks/chat/session'
import { useSettings } from '@/hooks/chat/settings'
import { generateId } from '@/lib'
import { normalizeBrowserUrl } from '@/lib/auth/site-url'
import type { MessageRole, PendingMessage } from '@/lib/chat'
import { api } from '@sb/convex/_generated/api'
import type { Doc, Id } from '@sb/convex/_generated/dataModel'
import type { ResolvedSettings } from '@sb/convex/model/defaults'
import { parseFileMentions } from '@sb/core/mentions/parse'
import type {
  WorkspaceDirectoryLink,
  WorkspaceTextLink,
} from '@sb/core/types/workspace'
import type { FileUIPart } from 'ai'
import type { OptimisticLocalStore } from 'convex/browser'
import { useAction, useMutation } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { useCallback } from 'react'

import { useIsWorkspaceAdmin } from './tools'

type WindowMessage = FunctionReturnType<
  typeof api.chat.messagesWindow
>['page'][number]

type StagedAttachment = { id: Id<'attachments'>; data?: string }
type ResolvedFileLink = {
  path: string
  snapshot?: WorkspaceTextLink | WorkspaceDirectoryLink
}

type SendArgs = {
  sessionId: Id<'sessions'>
  content: string
  role?: MessageRole
  attachments?: StagedAttachment[]
  fileLinks?: ResolvedFileLink[]
}

type UploadMeta = { mediaType: string; filename: string }

type StoreBlob = (blob: Blob, mediaType: string) => Promise<Id<'_storage'>>

type ConfirmAttachment = (args: {
  storageId: Id<'_storage'>
  previewStorageId?: Id<'_storage'>
  filename: string
  mediaType: string
}) => Promise<Id<'attachments'>>

type ResolveFileLinks = (args: {
  sessionId: Id<'sessions'>
  paths: string[]
}) => Promise<ResolvedFileLink[]>

export function useSendMessage() {
  const session = useActiveSession()
  const settings = useSettings()
  const profile = useUserProfile()
  const agent = useActiveAgent()
  const generateUploadUrl = useMutation(api.attachments.generateUploadUrl)
  const confirmAttachment = useMutation(api.attachments.confirm)
  const resolveFileLinks = useAction(api.actions.workspaces.resolveFileLinks)
  const isWorkspaceAdmin = useIsWorkspaceAdmin()

  const sendMutation = useMutation(api.chat.sendMessage).withOptimisticUpdate(
    (store, args) =>
      optimisticallyInsertMessage(store, args, profile, settings, agent),
  )

  return useCallback(
    async (pending: PendingMessage, role?: MessageRole) => {
      if (!session) return
      const content = pending.content.trim()
      const messageRole = role ?? pending.role ?? 'user'

      const storeBlob: StoreBlob = async (blob, mediaType) => {
        const uploadUrl = normalizeBrowserUrl(await generateUploadUrl({}))
        if (!uploadUrl) throw new Error('Upload URL not available')
        const response = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': mediaType },
          body: blob,
        })
        if (!response.ok) {
          throw new Error(`Upload failed: ${response.statusText}`)
        }
        const { storageId } = (await response.json()) as {
          storageId: Id<'_storage'>
        }
        return storageId
      }

      const canResolveLinks = Boolean(session.workspace) && isWorkspaceAdmin
      const [attachments, fileLinks] = await Promise.all([
        uploadFiles(pending.files, pending.originalFiles, storeBlob, (args) =>
          confirmAttachment({ ...args, sessionId: session._id }),
        ),
        resolveMentionedFileLinks(
          content,
          session._id,
          canResolveLinks,
          resolveFileLinks,
        ),
      ])

      await sendMutation({
        sessionId: session._id,
        content,
        ...(messageRole !== 'user' ? { role: messageRole } : {}),
        ...(pending.silent ? { silent: true } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(fileLinks !== undefined ? { fileLinks } : {}),
      })
    },
    [
      session,
      sendMutation,
      generateUploadUrl,
      confirmAttachment,
      resolveFileLinks,
      isWorkspaceAdmin,
    ],
  )
}

async function uploadFiles(
  files: FileUIPart[],
  originalFiles: Record<string, File> | undefined,
  storeBlob: StoreBlob,
  confirm: ConfirmAttachment,
): Promise<StagedAttachment[]> {
  const results = await Promise.all(
    files.map(async (part) => {
      try {
        const original = originalFiles?.[part.url]
        const meta = fileMeta(part, original)
        const isImage = meta.mediaType.startsWith('image/')

        const storageId = await storeBlob(
          original ?? (await dataUrlToBlob(part.url)),
          meta.mediaType,
        )
        const previewStorageId =
          isImage && original
            ? await storeBlob(await dataUrlToBlob(part.url), 'image/jpeg')
            : undefined

        const id = await confirm({ storageId, previewStorageId, ...meta })
        // Reuse the resized data for the optimistic update
        return isImage ? { id, data: part.url } : { id }
      } catch (err) {
        console.error('Failed to upload attachment:', err)
        return null
      }
    }),
  )
  return results.filter((r): r is StagedAttachment => r !== null)
}

function fileMeta(part: FileUIPart, original: File | undefined): UploadMeta {
  const mediaType =
    original?.type ?? part.mediaType ?? 'application/octet-stream'
  const filename =
    original?.name ??
    part.filename ??
    `attachment.${mediaType.split('/')[1]?.split('+')[0] ?? 'bin'}`
  return { mediaType, filename }
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl)
  return response.blob()
}

async function resolveMentionedFileLinks(
  content: string,
  sessionId: Id<'sessions'>,
  canResolve: boolean,
  resolveFileLinks: ResolveFileLinks,
): Promise<ResolvedFileLink[] | undefined> {
  if (!canResolve) return undefined
  const paths = parseFileMentions(content)
  if (paths.length === 0) return []
  return resolveFileLinks({ sessionId, paths })
}

function optimisticallyInsertMessage(
  store: OptimisticLocalStore,
  args: SendArgs,
  profile: Doc<'users'> | null,
  settings: ResolvedSettings | undefined,
  agent: ActiveAgent | null,
) {
  const content = args.content.trim()
  const fileParts = (args.attachments ?? []).flatMap((attachment) =>
    attachment.data
      ? [
          {
            type: 'file',
            url: attachment.data,
            mediaType:
              attachment.data.match(/^data:([^;,]+)/)?.[1] ?? 'image/jpeg',
            attachmentId: attachment.id,
          },
        ]
      : [],
  )
  if (!content && (args.attachments ?? []).length === 0) return

  const role = args.role ?? 'user'
  const id = generateId() as unknown as Id<'messages'>
  const parts = [
    ...fileParts,
    ...(content ? [{ type: 'text', text: content }] : []),
  ]
  const item = {
    _id: id,
    _creationTime: Date.now(),
    sessionId: args.sessionId,
    role,
    ...optimisticSender(role, profile, settings, agent, id),
    status: 'done',
    selectedVersion: 1,
    versionCount: 1,
    segments: [{ segmentIndex: 0, parts, sizeBytes: 0 }],
    sizeBytes: 0,
    hasOlderSegments: false,
    hasNewerSegments: false,
  }

  // Append to the live message window(s) for this session (anchor === null).
  const doc = item as unknown as WindowMessage
  for (const query of store.getAllQueries(api.chat.messagesWindow)) {
    if (query.args.sessionId !== args.sessionId || query.args.anchor !== null) {
      continue
    }
    const value = query.value
    if (!value) continue
    store.setQuery(api.chat.messagesWindow, query.args, {
      ...value,
      page: [...value.page, doc],
      atTail: true,
    })
  }
}

function optimisticSender(
  role: MessageRole,
  profile: Doc<'users'> | null,
  settings: ResolvedSettings | undefined,
  agent: ActiveAgent | null,
  fallbackId: Id<'messages'>,
) {
  // Assistant messages are sent on behalf of the active agent.
  if (role === 'assistant' && agent) {
    return {
      sender: { type: 'agent', id: agent._id },
      senderSnapshot: {
        name: agent.name,
        avatarId: agent.avatarId,
        css: agent.customCss,
        theme: agent.theme ?? settings?.theme,
      },
    }
  }

  const sender = {
    type: 'user',
    id: profile?._id ?? (fallbackId as unknown as Id<'users'>),
  }

  // System messages carry no sender identity (no header, no name prefix).
  if (role === 'system') return { sender }

  return {
    sender,
    senderSnapshot: {
      name: settings?.displayName ?? 'User',
      avatarId: settings?.avatarId,
      css: settings?.customCss,
      theme: settings?.theme,
    },
  }
}
