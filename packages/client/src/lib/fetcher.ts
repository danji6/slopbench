export type AssetMode = 'json' | 'blob' | 'text' | 'auto'

export async function assetFetcher<T>(
  url: string,
  mode: AssetMode = 'auto',
): Promise<T> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to fetch asset: ${response.statusText}`)
  }

  const contentType = response.headers.get('content-type') || ''

  if (mode === 'json') {
    return response.json()
  }

  if (mode === 'blob') {
    return response.blob() as T
  }

  if (mode === 'text') {
    return response.text() as T
  }

  if (
    contentType.includes('application/json') ||
    contentType.includes('text/json')
  ) {
    return response.json()
  }

  if (contentType.includes('text/')) {
    return response.text() as T
  }

  if (
    contentType.includes('application/') ||
    contentType.includes('image/') ||
    contentType.includes('video/') ||
    contentType.includes('audio/')
  ) {
    return response.blob() as T
  }

  try {
    return await response.json()
  } catch {
    return response.text() as T
  }
}
