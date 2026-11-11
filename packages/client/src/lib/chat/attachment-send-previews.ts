import type { LocalFilePreview } from '@/hooks/file-previews'
import type { Id } from '@sb/convex/_generated/dataModel'

export type StagedAttachment = {
  id: Id<'attachments'>
  filename: string
  mediaType: string
  byteLength: number
  preview: string | Blob
}

type SendPreview = Pick<StagedAttachment, 'byteLength'> & {
  preview: LocalFilePreview
}

const HANDOFF_MS = 60_000
const staged = new Map<string, SendPreview>()

export function getAttachmentSendPreview(id: string) {
  return staged.get(id)
}

/** Shares previews between the optimistic row and its replacement. */
export function keepAttachmentSendPreviews(attachments: StagedAttachment[]) {
  const objectUrls: string[] = []
  for (const { id, byteLength, preview } of attachments) {
    const url =
      typeof preview === 'string' ? preview : URL.createObjectURL(preview)
    if (typeof preview !== 'string') objectUrls.push(url)
    staged.set(id, { byteLength, preview: { url } })
  }

  return (sent: boolean) => {
    const release = () => {
      for (const { id } of attachments) staged.delete(id)
      for (const url of objectUrls) URL.revokeObjectURL(url)
    }
    if (sent) setTimeout(release, HANDOFF_MS)
    else release()
  }
}
