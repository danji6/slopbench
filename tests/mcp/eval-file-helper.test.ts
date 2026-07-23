/// <reference types="bun-types" />
import {
  createFileExistsHelper,
  createFileHelper,
} from '@sb/sidecar/eval/fileHelper'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

let root: string
let outside: string

describe('createFileHelper', () => {
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'chat-eval-root-'))
    outside = await mkdtemp(path.join(tmpdir(), 'chat-eval-outside-'))
    await writeFile(path.join(root, 'AGENTS.md'), 'Use bun.\n', 'utf-8')
    await mkdir(path.join(root, 'docs'))
    await writeFile(path.join(root, 'docs', 'STYLE.md'), 'Tabs.\n', 'utf-8')
    await writeFile(path.join(outside, 'secret.txt'), 'nope', 'utf-8')
    await symlink(
      path.join(outside, 'secret.txt'),
      path.join(root, 'sneaky.txt'),
    )
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  test('reads files relative to the workspace root, unwrapped', () => {
    const file = createFileHelper(root)
    expect(file('AGENTS.md', false)).toBe('Use bun.\n')
    expect(file('docs/STYLE.md', false)).toBe('Tabs.\n')
  })

  test('wraps content in a file block by default', () => {
    const file = createFileHelper(root)
    expect(file('AGENTS.md')).toBe(
      '<file path="AGENTS.md">\nUse bun.\n\n</file>',
    )
    expect(file('docs/STYLE.md')).toBe(
      '<file path="docs/STYLE.md">\nTabs.\n\n</file>',
    )
  })

  test('returns empty for missing files and empty paths', () => {
    const file = createFileHelper(root)
    expect(file('MISSING.md')).toBe('')
    expect(file('')).toBe('')
  })

  test('returns empty without a workspace root', () => {
    expect(createFileHelper(undefined)('AGENTS.md')).toBe('')
    expect(createFileHelper('/definitely/not/a/real/dir')('AGENTS.md')).toBe('')
  })

  test('throws on paths that escape the root', () => {
    const file = createFileHelper(root)
    expect(() => file('../escape.txt')).toThrow(/escapes/)
    expect(() => file(path.join(outside, 'secret.txt'))).toThrow(/escapes/)
  })

  test('throws on symlinks that escape the root', () => {
    const file = createFileHelper(root)
    expect(() => file('sneaky.txt')).toThrow(/escapes/)
  })

  test('truncates oversized files', async () => {
    await writeFile(path.join(root, 'big.txt'), 'x'.repeat(60_000), 'utf-8')
    const content = createFileHelper(root)('big.txt', false)
    expect(content.endsWith('\n[truncated]')).toBe(true)
    expect(content.length).toBeLessThan(60_000)
  })
})

describe('createFileExistsHelper', () => {
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'chat-exists-root-'))
    outside = await mkdtemp(path.join(tmpdir(), 'chat-exists-outside-'))
    await writeFile(path.join(root, 'AGENTS.md'), 'Use bun.\n', 'utf-8')
    await mkdir(path.join(root, 'docs'))
    await writeFile(path.join(outside, 'secret.txt'), 'nope', 'utf-8')
    await symlink(
      path.join(outside, 'secret.txt'),
      path.join(root, 'sneaky.txt'),
    )
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  test('returns true for an existing workspace file', () => {
    expect(createFileExistsHelper(root)('AGENTS.md')).toBe(true)
  })

  test('returns false for missing files, empty paths, and directories', () => {
    const fileExists = createFileExistsHelper(root)
    expect(fileExists('MISSING.md')).toBe(false)
    expect(fileExists('')).toBe(false)
    expect(fileExists('docs')).toBe(false)
  })

  test('returns false without a workspace root', () => {
    expect(createFileExistsHelper(undefined)('AGENTS.md')).toBe(false)
    expect(
      createFileExistsHelper('/definitely/not/a/real/dir')('AGENTS.md'),
    ).toBe(false)
  })

  test('returns false for paths that escape the root', () => {
    const fileExists = createFileExistsHelper(root)
    expect(fileExists('../secret.txt')).toBe(false)
    expect(fileExists(path.join(outside, 'secret.txt'))).toBe(false)
    expect(fileExists('sneaky.txt')).toBe(false)
  })
})
