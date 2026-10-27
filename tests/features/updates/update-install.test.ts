/// <reference types="bun-types" />
import { installBlockReason, resolveInstall } from '@sb/core/update/install'
import { describe, expect, test } from 'bun:test'

const release = JSON.stringify({ version: '0.3.0', commit: 'abc1234' })
const packageJson = JSON.stringify({ version: '0.3.0' })

describe('resolveInstall', () => {
  test('a release archive may update itself', () => {
    expect(resolveInstall({ hasGit: false, packageJson, release })).toEqual({
      commit: 'abc1234',
      kind: 'released',
      updatable: true,
      version: '0.3.0',
    })
  })

  // Swapping the tree under a checkout would discard the user's own work, so
  // the git check wins even when a release.json is lying around.
  test('a git checkout never updates itself', () => {
    const install = resolveInstall({ hasGit: true, packageJson, release })

    expect(install.kind).toBe('git-checkout')
    expect(install.updatable).toBe(false)
  })

  test('a source tree without a release.json never updates itself', () => {
    const install = resolveInstall({ hasGit: false, packageJson })

    expect(install.kind).toBe('source-checkout')
    expect(install.updatable).toBe(false)
    expect(install.version).toBe('0.3.0')
  })

  test('falls back to package.json, then to a placeholder version', () => {
    expect(resolveInstall({ hasGit: false, packageJson }).version).toBe('0.3.0')
    expect(resolveInstall({ hasGit: false }).version).toBe('0.0.0')
  })

  test('treats unreadable manifests as absent', () => {
    const install = resolveInstall({
      hasGit: false,
      packageJson: '{ not json',
      release: 'also not json',
    })

    expect(install.kind).toBe('source-checkout')
    expect(install.version).toBe('0.0.0')
  })
})

describe('installBlockReason', () => {
  test('explains why an install cannot update itself', () => {
    expect(installBlockReason('git-checkout')).toContain('git pull')
    expect(installBlockReason('source-checkout')).toContain('release')
    expect(installBlockReason('released')).toBeUndefined()
  })
})
