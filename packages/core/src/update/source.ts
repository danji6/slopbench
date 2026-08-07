import { normalizeVersion } from './version'

export type ReleaseAsset = {
  name: string
  url: string
}

export type ReleaseInfo = {
  /** Version without a leading `v`. */
  version: string
  tag: string
  notes: string
  publishedAt: string
  /** The release page. */
  url: string
  assets: ReleaseAsset[]
}

export const DEFAULT_UPDATE_FEED_URL =
  'https://api.github.com/repos/danji6/slopbench/releases/latest'

const CACHE_TTL_MS = 60 * 60 * 1000

type CacheEntry = { at: number; value: ReleaseInfo | null }

let cache: CacheEntry | undefined

export function updateFeedUrl(): string {
  return process.env.UPDATE_FEED_URL || DEFAULT_UPDATE_FEED_URL
}

/**
 * The newest published release, or `null` when the feed is unreachable or
 * has nothing usable. Failures are cached until the server is restarted.
 */
export async function fetchLatestRelease(options?: {
  ttlMs?: number
  now?: number
}): Promise<ReleaseInfo | null> {
  const now = options?.now ?? Date.now()
  const ttl = options?.ttlMs ?? CACHE_TTL_MS

  if (cache && now - cache.at < ttl) return cache.value

  const value = await loadLatestRelease()
  cache = { at: now, value }
  return value
}

export function clearReleaseCache() {
  cache = undefined
}

async function loadLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const response = await fetch(updateFeedUrl(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return null
    return parseRelease(await response.json())
  } catch {
    return null
  }
}

/** Maps a GitHub-shaped release payload onto {@link ReleaseInfo}. */
export function parseRelease(body: unknown): ReleaseInfo | null {
  if (!body || typeof body !== 'object') return null

  const release = body as Record<string, unknown>
  const tag = typeof release.tag_name === 'string' ? release.tag_name : ''
  if (!tag || release.draft === true) return null

  return {
    version: normalizeVersion(tag),
    tag,
    notes: typeof release.body === 'string' ? release.body : '',
    publishedAt:
      typeof release.published_at === 'string' ? release.published_at : '',
    url: typeof release.html_url === 'string' ? release.html_url : '',
    assets: parseAssets(release.assets),
  }
}

function parseAssets(value: unknown): ReleaseAsset[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const asset = entry as Record<string, unknown>
    const name = asset.name
    const url = asset.browser_download_url
    if (typeof name !== 'string' || typeof url !== 'string') return []
    return [{ name, url }]
  })
}

export function selectArchiveAsset(
  release: ReleaseInfo,
  platform: string = process.platform,
): ReleaseAsset | undefined {
  const suffix = platform === 'win32' ? '.zip' : '.tar.gz'
  return release.assets.find((asset) => asset.name.endsWith(suffix))
}

export function selectChecksumAsset(
  release: ReleaseInfo,
): ReleaseAsset | undefined {
  return release.assets.find((asset) => asset.name === CHECKSUM_ASSET)
}

export const CHECKSUM_ASSET = 'checksums.txt'

/** Reads a `<sha256>  <filename>` listing into a name → digest map. */
export function parseChecksums(body: string): Map<string, string> {
  const entries = new Map<string, string>()

  for (const line of body.split('\n')) {
    const match = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line)
    if (match) entries.set(match[2], match[1].toLowerCase())
  }

  return entries
}
