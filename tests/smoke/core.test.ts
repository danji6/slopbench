import { normalizeAgentPaths } from '@sb/convex/model/caps'
import { MAX_APPROVAL_PATHS, MAX_APPROVAL_PATH_BYTES } from '@sb/core/limits'
import {
  approvalPathsBytes,
  approvalPathsError,
  capApprovalPaths,
  foldPaths,
  isPathAllowed,
  normalizeApprovalPath,
} from '@sb/core/workspace/path-policy'
import { describe, expect, test } from 'bun:test'

describe('literal path grants', () => {
  test('normalizes roots, dot segments and directory boundaries', () => {
    expect(normalizeApprovalPath('./build/../src//')).toBe('src')
    expect(isPathAllowed('src/new/file.ts', ['./src/'])).toBe(true)
    expect(isPathAllowed('src-other/file.ts', ['src'])).toBe(false)
    expect(isPathAllowed('src/file.ts', ['.'])).toBe(true)
    expect(isPathAllowed('../outside', ['.'])).toBe(false)
    expect(isPathAllowed('/tmp/file', ['/'])).toBe(true)
    expect(isPathAllowed('/tmp/file', ['.'])).toBe(false)
    expect(isPathAllowed('src/a.ts', ['src/*.ts'])).toBe(false)
  })

  test('requires an explicit grant for each .git subtree', () => {
    expect(isPathAllowed('.git/config', ['.'])).toBe(false)
    expect(isPathAllowed('/repo/.git/config', ['/repo'])).toBe(false)
    expect(isPathAllowed('/repo/.git/config', ['/repo/.git'])).toBe(true)
    expect(isPathAllowed('.git/HEAD', ['.git/config'])).toBe(false)
    expect(isPathAllowed('.git/nested/.git/config', ['.git'])).toBe(false)
    expect(foldPaths(['.', '.git', './.git/config', 'src', './src/'])).toEqual([
      '.',
      '.git',
    ])
  })

  test('validates writes and normalizes only literal entries', () => {
    expect(normalizeAgentPaths([' src/ ', './src', '.git'])).toEqual([
      'src',
      '.git',
    ])
    for (const value of ['', ' ', '~/files', '$HOME/files', 'a\0b']) {
      expect(() => normalizeAgentPaths([value])).toThrow()
    }
    expect(
      normalizeAgentPaths(['/tmp/shared', 'file with spaces', 'literal*']),
    ).toEqual(['/tmp/shared', 'file with spaces', 'literal*'])
  })

  test('accepts parent-relative grants in agent and session lists', () => {
    const entries = [' ../project_2/ ', './src/../../project_2', '../../shared']
    expect(normalizeAgentPaths(entries)).toEqual([
      '../project_2',
      '../../shared',
    ])
    expect(capApprovalPaths(entries)).toEqual(['../project_2', '../../shared'])
    expect(normalizeAgentPaths(['..'])).toEqual(['..'])
    expect(isPathAllowed('../project_2/new/file', ['../project_2'])).toBe(true)
    expect(isPathAllowed('../project_2-cache/file', ['../project_2'])).toBe(
      false,
    )
    expect(foldPaths(['..', '../project_2/.git', '../project_2'])).toEqual([
      '..',
      '../project_2/.git',
    ])
  })

  test('bounds both count and UTF-8 serialized size', () => {
    expect(
      approvalPathsError(
        Array.from({ length: MAX_APPROVAL_PATHS + 1 }, (_, i) => `/tmp/${i}`),
      ),
    ).toContain('limit exceeded')
    const oversized = ['é'.repeat(MAX_APPROVAL_PATH_BYTES / 2)]
    expect(approvalPathsError(oversized)).toContain('bytes')
    const capped = capApprovalPaths(['src', ...oversized, '.git'])
    expect(capped).toEqual(['src', '.git'])
    expect(approvalPathsBytes(capped)).toBeLessThanOrEqual(
      MAX_APPROVAL_PATH_BYTES,
    )
  })
})
