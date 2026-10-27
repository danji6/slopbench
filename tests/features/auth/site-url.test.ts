/// <reference types="bun-types" />
import {
  getAuthSiteUrl,
  getConvexClientUrl,
  normalizeBrowserUrl,
} from '@/lib/auth/site-url'
import { describe, expect, test } from 'bun:test'

describe('getAuthSiteUrl', () => {
  test('uses the explicit Convex site URL when present', () => {
    expect(
      getAuthSiteUrl({
        VITE_CONVEX_SITE_URL: 'http://localhost:3211',
        VITE_CONVEX_URL: 'http://localhost:3210',
      }),
    ).toBe('http://localhost:3211')
  })

  test('maps explicit local site URLs to the browser hostname', () => {
    expect(
      getAuthSiteUrl({
        CURRENT_ORIGIN: 'http://192.168.1.10:5173',
        VITE_CONVEX_SITE_URL: 'http://localhost:3211',
      }),
    ).toBe('http://192.168.1.10:3211')
  })

  test('normalizes explicit local loopback site URLs to localhost', () => {
    expect(
      getAuthSiteUrl({
        VITE_CONVEX_SITE_URL: 'http://127.0.0.1:3211',
      }),
    ).toBe('http://localhost:3211')
  })

  test('derives the local site URL from the local Convex backend URL', () => {
    expect(
      getAuthSiteUrl({
        VITE_CONVEX_URL: 'http://localhost:3210',
      }),
    ).toBe('http://localhost:3211')
  })

  test('derives local site URLs from the browser hostname', () => {
    expect(
      getAuthSiteUrl({
        CURRENT_ORIGIN: 'http://192.168.1.10:5173',
        VITE_CONVEX_URL: 'http://localhost:3210',
      }),
    ).toBe('http://192.168.1.10:3211')
  })

  test('normalizes local loopback Convex URLs to localhost', () => {
    expect(
      getAuthSiteUrl({
        VITE_CONVEX_URL: 'http://127.0.0.1:3210',
      }),
    ).toBe('http://localhost:3211')
  })

  test('derives the hosted site URL from a hosted Convex backend URL', () => {
    expect(
      getAuthSiteUrl({
        VITE_CONVEX_URL: 'https://example-123.convex.cloud',
      }),
    ).toBe('https://example-123.convex.site')
  })
})

describe('getConvexClientUrl', () => {
  test('maps local Convex URLs to the browser hostname', () => {
    expect(
      getConvexClientUrl({
        CURRENT_ORIGIN: 'http://192.168.1.10:5173',
        VITE_CONVEX_URL: 'http://localhost:3210',
      }),
    ).toBe('http://192.168.1.10:3210')
  })

  test('keeps hosted Convex URLs unchanged', () => {
    expect(
      getConvexClientUrl({
        CURRENT_ORIGIN: 'http://192.168.1.10:5173',
        VITE_CONVEX_URL: 'https://example-123.convex.cloud',
      }),
    ).toBe('https://example-123.convex.cloud')
  })
})

describe('normalizeBrowserUrl', () => {
  test('maps local storage URLs to the browser hostname', () => {
    expect(
      normalizeBrowserUrl(
        'http://localhost:3211/api/storage/file',
        'http://192.168.1.10:5173',
      ),
    ).toBe('http://192.168.1.10:3211/api/storage/file')
  })

  test('keeps remote URLs unchanged', () => {
    expect(
      normalizeBrowserUrl(
        'https://example.com/api/storage/file',
        'http://192.168.1.10:5173',
      ),
    ).toBe('https://example.com/api/storage/file')
  })
})
