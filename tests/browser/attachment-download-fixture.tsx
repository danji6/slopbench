import { FileBlock } from '@/components/chat/messages/file-block'
import { AttachmentAnchor } from '@/components/markdown/attachment-anchor'
import { FileStrip } from '@/components/ui/file-strip'
import { AttachmentUrlProvider } from '@/hooks/chat/attachment-urls'
import type { FileItem } from '@/hooks/file-previews'
import { ConvexProvider, type ConvexReactClient } from 'convex/react'

const files: FileItem[] = [
  {
    id: 'image',
    file: new File([], 'image.png', { type: 'image/png' }),
    url: 'attachment:image',
    originalUrl: 'https://storage.example.test/image-original',
    permaUrl: 'https://site.example.test/attachments/image/image.png',
  },
]

const publishedUrl = 'attachment:published'
const attachmentUrls = {
  published: {
    url: 'https://storage.example.test/published-pdf',
    byteLength: 13,
    mediaType: 'application/pdf',
    filename: 'processed.pdf',
  },
}
const attachmentClient = {
  watchQuery() {
    return {
      onUpdate: () => () => {},
      localQueryResult: () => attachmentUrls,
      localQueryLogs: () => [],
      journal: () => undefined,
    }
  },
} as unknown as ConvexReactClient

export function AttachmentDownloadFixture() {
  return (
    <>
      <FileStrip files={files} noAnimation />
      <ConvexProvider client={attachmentClient}>
        <AttachmentUrlProvider />
        <FileBlock
          parts={[
            {
              type: 'file',
              url: publishedUrl,
              mediaType: 'application/pdf',
              filename: 'processed.pdf',
            },
          ]}
          attachmentIds={{ [publishedUrl]: 'published' }}
        />
      </ConvexProvider>
      <AttachmentAnchor href="attachment:notes/caf%C3%A9.json">
        Shared notes
      </AttachmentAnchor>
    </>
  )
}
