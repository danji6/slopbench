/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { belowMinimum } from '~/scripts/runner/bun-pin'
import { getConfig, projectRoot, versions } from '~/scripts/runner/config'
import { output } from '~/scripts/runner/processes'

/** Bun versions to compare against a `1.5.0` floor, both sides of it. */
const CANDIDATES = [
  '1.4.9',
  '1.5.0',
  '1.5.1',
  '2.0.0',
  '1.5.0-canary.20260101',
  '1.6.0-canary.1',
  '0.9.9',
]

const previousEnv = { ...process.env }

afterEach(() => {
  process.env = { ...previousEnv }
})

describe('binary pins', () => {
  test('versions.json declares every pin the launchers read', async () => {
    const raw = JSON.parse(
      await readFile(join(projectRoot, 'versions.json'), 'utf8'),
    ) as Record<string, unknown>

    expect(Object.keys(raw).sort()).toEqual([
      'bun',
      'bunMinimum',
      'convexBackend',
      'node',
    ])
    for (const value of Object.values(raw)) {
      expect(typeof value).toBe('string')
    }
  })

  test('the runner takes Node and Convex from the pins', () => {
    delete process.env.RELEASE_TAG
    delete process.env.RUNNER_NODE_VERSION
    delete process.env.CONVEX_BINARY
    delete process.env.NODE_BINARY

    const config = getConfig('start')

    expect(config.releaseTag).toBe(versions.convexBackend)
    expect(config.nodeVersion).toBe(versions.node)
    expect(config.manageConvexBinary).toBe(true)
    expect(config.manageNodeBinary).toBe(true)
  })

  test('a binary the user supplies is left alone', () => {
    process.env.CONVEX_BINARY = '/opt/convex'
    process.env.NODE_BINARY = '/opt/node'

    const config = getConfig('start')

    expect(config.manageConvexBinary).toBe(false)
    expect(config.manageNodeBinary).toBe(false)
  })

  // Otherwise the bootstrap installs the pinned Bun, the runner rejects it for
  // being under the floor, and the two send the user round forever.
  test('the pinned Bun satisfies the minimum it declares', () => {
    expect(belowMinimum(versions.bun, versions.bunMinimum)).toBe(false)
  })

  test('a pre-release Bun is judged on its release version', () => {
    // The bootstrap drops the suffix, so treating it as older would loop.
    expect(belowMinimum('1.5.0-canary.20260101', '1.5.0')).toBe(false)
    expect(belowMinimum('1.4.9-canary.1', '1.5.0')).toBe(true)
  })

  test('an unreadable version is never called too old', () => {
    expect(belowMinimum('garbage', '1.5.0')).toBe(false)
    expect(belowMinimum('1.5.0', '')).toBe(false)
    expect(belowMinimum('1.5', '1.5.0')).toBe(false)
  })

  // The pair only agrees to disagree in one direction: whenever the runner
  // demands a relaunch, the bootstrap must install a different Bun.
  test.skipIf(process.platform === 'win32')(
    'the shell bootstrap rejects every Bun the runner does',
    async () => {
      const bootstrap = join(projectRoot, 'scripts/bootstrap.sh')
      const accepted = await output(
        [
          'bash',
          '-c',
          `set -euo pipefail
           eval "$(sed -n '/^version_at_least()/,/^}/p' "${bootstrap}")"
           for candidate in ${CANDIDATES.join(' ')}; do
             if version_at_least "$candidate" 1.5.0; then echo yes; else echo no; fi
           done`,
        ],
        { cwd: projectRoot },
      )

      const lines = accepted.trim().split('\n')
      expect(lines).toHaveLength(CANDIDATES.length)
      for (const [index, candidate] of CANDIDATES.entries()) {
        if (!belowMinimum(candidate, '1.5.0')) continue
        expect(`${candidate}: ${lines[index]}`).toBe(`${candidate}: no`)
      }
    },
  )

  // The bootstrap parses versions.json with sed rather than a JSON parser, so
  // reshaping the file would silently leave it reading stale pins.
  test.skipIf(process.platform === 'win32')(
    'the shell bootstrap reads the same pins',
    async () => {
      const bootstrap = join(projectRoot, 'scripts/bootstrap.sh')
      const read = await output(
        [
          'bash',
          '-c',
          `set -euo pipefail
           eval "$(sed -n '/^json_value()/,/^}/p' "${bootstrap}")"
           printf '%s\\n%s\\n%s\\n%s' "$(json_value bun)" \
             "$(json_value bunMinimum)" "$(json_value convexBackend)" \
             "$(json_value node)"`,
        ],
        { cwd: projectRoot },
      )

      expect(read.split('\n')).toEqual([
        versions.bun,
        versions.bunMinimum,
        versions.convexBackend,
        versions.node,
      ])
    },
  )
})
