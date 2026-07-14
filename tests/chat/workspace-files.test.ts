/// <reference types="bun-types" />
import {
  detectWorkspaceMediaType,
  isKnownTextFile,
  isKnownTextMediaType,
  isTextFilename,
} from '@sb/core/workspace/files'
import { describe, expect, test } from 'bun:test'

describe('workspace file classification', () => {
  test('detects binary media types by extension', () => {
    expect(detectWorkspaceMediaType('assets/photo.jpeg')).toBe('image/jpeg')
    expect(detectWorkspaceMediaType('docs/manual.pdf')).toBe('application/pdf')
  })

  test('detects text paths by extension and special filename', () => {
    expect(detectWorkspaceMediaType('src/index.ts')).toBe('text/plain')
    expect(detectWorkspaceMediaType('Dockerfile')).toBe('text/plain')
    expect(isTextFilename('.env.local')).toBe(true)
  })

  test('falls back to octet stream for unknown extensions', () => {
    expect(detectWorkspaceMediaType('data/archive.unknown')).toBe(
      'application/octet-stream',
    )
  })

  test('detects known text media types', () => {
    expect(isKnownTextMediaType('application/json; charset=utf-8')).toBe(true)
    expect(isKnownTextMediaType('application/vnd.api+json')).toBe(true)
    expect(isKnownTextMediaType('application/pdf')).toBe(false)
  })

  test('combines media type and filename checks for uploaded files', () => {
    expect(isKnownTextFile('application/octet-stream', 'README.md')).toBe(true)
    expect(isKnownTextFile('application/json', 'payload.bin')).toBe(true)
    expect(isKnownTextFile('application/octet-stream', 'payload.bin')).toBe(
      false,
    )
  })
})
