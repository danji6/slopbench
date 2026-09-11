import { attachmentReference } from '@sb/core/attachments'
import { defaultUrlTransform } from 'react-markdown'

/** Preserves validated attachment references while filtering other URLs. */
export function attachmentUrlTransform(url: string): string {
  return url.startsWith('attachment:') && attachmentReference(url)
    ? url
    : defaultUrlTransform(url)
}
