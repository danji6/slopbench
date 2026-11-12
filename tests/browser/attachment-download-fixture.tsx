import { AttachmentAnchor } from '@/components/markdown/attachment-anchor'
import { FileStrip } from '@/components/ui/file-strip'
import type { FileItem } from '@/hooks/file-previews'

const files: FileItem[] = [
  {
    id: 'image',
    file: new File([], 'image.png', { type: 'image/png' }),
    url: 'attachment:image',
    originalUrl: 'https://storage.example.test/image-original',
    permaUrl: 'https://site.example.test/attachments/image/image.png',
  },
]

export function AttachmentDownloadFixture() {
  return (
    <>
      <FileStrip files={files} noAnimation />
      <AttachmentAnchor href="attachment:notes/caf%C3%A9.json">
        Shared notes
      </AttachmentAnchor>
    </>
  )
}
