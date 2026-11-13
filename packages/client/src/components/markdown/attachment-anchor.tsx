import { T } from '@/components/ui/typography'
import { convexSiteUrl } from '@/hooks/http'
import { downloadAttachment } from '@/lib/chat/attachment-download'
import { attachmentPath, attachmentReference } from '@cv/core/attachments'

/** Resolves an attachment reference when it is clicked. */
export function AttachmentAnchor({
  href,
  onClick,
  ...props
}: { href: string } & React.ComponentProps<'a'>) {
  const reference = attachmentReference(href)
  if (!reference) return <T.a {...props} />

  return (
    <T.a
      href={href}
      title={`Download ${reference.filename}`}
      data-attachment-reference=""
      {...props}
      onClick={(event) => {
        event.preventDefault()
        const downloadUrl = `${convexSiteUrl()}${attachmentPath(reference.token, reference.filename)}`
        void downloadAttachment(downloadUrl, reference.filename, {
          shared: true,
        })
        onClick?.(event)
      }}
    />
  )
}
