import { normalizeBrowserUrl } from '@/lib/auth/site-url'
import { assetFetcher } from '@/lib/fetcher'
import { toastError } from '@/lib/notifications'
import { download } from '@/lib/utils'

/** Saves the original attachment using the browser's download flow. */
export async function downloadAttachment(
  url: string,
  filename: string,
  { shared = false } = {},
) {
  try {
    if (shared) {
      const endpoint = new URL(url)
      endpoint.searchParams.set('resolve', '1')
      const { url: storageUrl } = await assetFetcher<{ url: string }>(
        endpoint.href,
        'json',
      )
      const normalized = normalizeBrowserUrl(storageUrl)
      if (!normalized) throw new Error('Attachment not found')
      url = normalized
    }

    const blob = await assetFetcher<Blob>(url, 'blob')
    download(blob, filename)
  } catch (error) {
    toastError(error, 'Failed to download attachment')
  }
}
