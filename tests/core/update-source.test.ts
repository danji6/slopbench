/// <reference types="bun-types" />
import {
  type ReleaseInfo,
  parseChecksums,
  parseRelease,
  selectArchiveAsset,
  selectChecksumAsset,
} from '@sb/core/update/source'
import { describe, expect, test } from 'bun:test'

const payload = {
  tag_name: 'v0.3.0',
  body: 'Fixed things.',
  published_at: '2026-08-10T12:00:00Z',
  html_url: 'https://example.test/releases/v0.3.0',
  assets: [
    {
      name: 'slopbench-0.3.0.tar.gz',
      browser_download_url: 'https://example.test/slopbench-0.3.0.tar.gz',
    },
    {
      name: 'slopbench-0.3.0.zip',
      browser_download_url: 'https://example.test/slopbench-0.3.0.zip',
    },
    { name: 'checksums.txt', browser_download_url: 'https://example.test/checksums.txt' }, // prettier-ignore
  ],
}

describe('parseRelease', () => {
  test('maps a release feed entry onto the shared shape', () => {
    const release = parseRelease(payload)

    expect(release?.version).toBe('0.3.0')
    expect(release?.tag).toBe('v0.3.0')
    expect(release?.notes).toBe('Fixed things.')
    expect(release?.publishedAt).toBe('2026-08-10T12:00:00Z')
    expect(release?.assets).toHaveLength(3)
  })

  test('ignores drafts and unusable payloads', () => {
    expect(parseRelease({ ...payload, draft: true })).toBeNull()
    expect(parseRelease({ body: 'no tag' })).toBeNull()
    expect(parseRelease(null)).toBeNull()
    expect(parseRelease('nope')).toBeNull()
  })

  test('drops assets that are missing a name or a URL', () => {
    const release = parseRelease({
      ...payload,
      assets: [{ name: 'orphan.zip' }, { browser_download_url: 'x' }, 7],
    })
    expect(release?.assets).toEqual([])
  })
})

describe('asset selection', () => {
  const release = parseRelease(payload) as ReleaseInfo

  // Matched by extension rather than by filename, so renaming the project
  // cannot strand installs that only know the old name.
  test('picks the archive each platform can extract', () => {
    expect(selectArchiveAsset(release, 'win32')?.name).toBe('slopbench-0.3.0.zip') // prettier-ignore
    expect(selectArchiveAsset(release, 'linux')?.name).toBe('slopbench-0.3.0.tar.gz') // prettier-ignore
    expect(selectArchiveAsset(release, 'darwin')?.name).toBe('slopbench-0.3.0.tar.gz') // prettier-ignore
  })

  test('finds the checksum listing', () => {
    expect(selectChecksumAsset(release)?.name).toBe('checksums.txt')
  })

  test('reports nothing when the release has no archive', () => {
    const empty = parseRelease({ ...payload, assets: [] }) as ReleaseInfo
    expect(selectArchiveAsset(empty, 'linux')).toBeUndefined()
    expect(selectChecksumAsset(empty)).toBeUndefined()
  })
})

describe('parseChecksums', () => {
  test('reads a sha256sum listing', () => {
    const digest = 'a'.repeat(64)
    const entries = parseChecksums(
      `${digest}  slopbench-0.3.0.tar.gz\n${'b'.repeat(64)} *slopbench-0.3.0.zip\n\n`,
    )

    expect(entries.get('slopbench-0.3.0.tar.gz')).toBe(digest)
    expect(entries.get('slopbench-0.3.0.zip')).toBe('b'.repeat(64))
    expect(entries.size).toBe(2)
  })

  test('skips lines that are not checksums', () => {
    expect(parseChecksums('# a comment\nnot a digest file.zip').size).toBe(0)
  })
})
