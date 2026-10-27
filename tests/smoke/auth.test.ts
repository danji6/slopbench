/// <reference types="bun-types" />
import { isAllowedOrigin, siteUrl } from '@sb/convex/origins'
import { afterEach, describe, expect, test } from 'bun:test'

const env = { ...process.env }

afterEach(() => {
  process.env = { ...env }
})

function configure(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

describe('isAllowedOrigin', () => {
  test('allows the configured frontend origin', () => {
    configure({
      FRONTEND_URL: 'https://chat.example.com',
      SITE_URL: 'https://convex-site.example.com',
      TRUST_ALL_ORIGINS: 'false',
    })

    expect(
      isAllowedOrigin(
        'https://chat.example.com',
        'https://convex-site.example.com/api/auth/convex/token',
      ),
    ).toBe(true)
  })

  test('rejects an unrelated origin on a public deployment', () => {
    configure({
      FRONTEND_URL: 'https://chat.example.com',
      SITE_URL: 'https://convex-site.example.com',
      TRUST_ALL_ORIGINS: 'false',
    })

    expect(
      isAllowedOrigin(
        'https://evil.example.net',
        'https://convex-site.example.com/api/auth/convex/token',
      ),
    ).toBe(false)
  })

  test('allows another port of the same host on a private address', () => {
    configure({
      FRONTEND_URL: 'http://localhost:4173',
      SITE_URL: 'http://localhost:3211',
      TRUST_ALL_ORIGINS: 'false',
    })

    expect(
      isAllowedOrigin('http://192.168.1.10:4173', 'http://192.168.1.10:3211/'),
    ).toBe(true)
  })

  test('rejects a foreign origin even on a private address', () => {
    configure({
      FRONTEND_URL: 'http://localhost:4173',
      SITE_URL: 'http://localhost:3211',
      TRUST_ALL_ORIGINS: 'false',
    })

    expect(
      isAllowedOrigin('https://evil.example.net', 'http://192.168.1.10:3211/'),
    ).toBe(false)
  })

  test('trusts everything when explicitly opted in', () => {
    configure({
      FRONTEND_URL: 'https://chat.example.com',
      SITE_URL: 'https://convex-site.example.com',
      TRUST_ALL_ORIGINS: 'true',
    })

    expect(
      isAllowedOrigin(
        'https://evil.example.net',
        'https://convex-site.example.com/',
      ),
    ).toBe(true)
  })
})

describe('siteUrl', () => {
  test('prefers a configured public site URL over the request origin', () => {
    configure({ SITE_URL: 'https://convex-site.example.com' })

    expect(siteUrl('http://10.0.0.4:3211/api/auth/get-session')).toBe(
      'https://convex-site.example.com',
    )
  })

  test('falls back to the request origin when only a local URL is set', () => {
    configure({ SITE_URL: 'http://localhost:3211' })

    expect(siteUrl('http://192.168.1.10:3211/api/auth/get-session')).toBe(
      'http://192.168.1.10:3211',
    )
  })
})
