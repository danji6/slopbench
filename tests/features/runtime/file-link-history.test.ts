import { buildProviderHistory } from '@sb/convex/actions/stream/history'
import { describe, expect, test } from 'bun:test'
import {
  providerData,
  providerDataWithWorkspace,
  userMessage,
  withFetch,
} from '~/tests/helpers/provider-history'

describe('provider file-link history', () => {
  test('uses embedded file link snapshots for provider history', async () => {
    const message = userMessage([
      {
        type: 'file-link',
        path: 'src/a.ts',
        snapshot: {
          kind: 'text',
          path: 'src/a.ts',
          content: 'const x = 1',
          truncated: false,
        },
      },
      { type: 'text', text: 'explain @src/a.ts' },
    ])
    const ctx = {
      runQuery: async () => [message],
    } as never

    const history = await withFetch(
      () => {
        throw new Error('History must not reread the workspace')
      },
      async () => {
        const unbound = await buildProviderHistory(ctx, providerData(), [])
        const bound = await buildProviderHistory(
          ctx,
          providerDataWithWorkspace(),
          [],
        )
        expect(bound).toEqual(unbound)
        return unbound
      },
    )

    expect(history).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<file path="src/a.ts">\nconst x = 1\n</file>',
          },
          { type: 'text', text: 'explain @src/a.ts' },
        ],
      },
    ])
  })

  test('snapshotless links stay unavailable across workspace and file changes', async () => {
    const message = userMessage([
      { type: 'file-link', path: 'logo.png' },
      { type: 'text', text: 'describe @logo.png' },
    ])
    const ctx = { runQuery: async () => [message] } as never
    let reads = 0
    const [first, second] = await withFetch(
      () => {
        reads++
        throw new Error('History must not reread the workspace')
      },
      async () => [
        await buildProviderHistory(ctx, providerData(), []),
        await buildProviderHistory(ctx, providerDataWithWorkspace(), []),
      ],
    )
    expect(second).toEqual(first)
    expect(first).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<file path="logo.png" status="unavailable">\nThis file is no longer available.\n</file>',
          },
          { type: 'text', text: 'describe @logo.png' },
        ],
      },
    ])
    expect(reads).toBe(0)
  })

  test('renders an over-cap binary link as a skip marker', async () => {
    const message = userMessage([
      {
        type: 'file-link',
        path: 'huge.bin',
        snapshot: {
          kind: 'skipped',
          path: 'huge.bin',
          reason: 'larger than 2000000 bytes',
        },
      },
    ])
    const ctx = { runQuery: async () => [message] } as never

    const history = await withFetch(
      () => {
        throw new Error('a skipped link must not read the workspace')
      },
      () => buildProviderHistory(ctx, providerDataWithWorkspace(), []),
    )

    expect(history).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              '<file path="huge.bin" status="skipped">\n' +
              'Not included: larger than 2000000 bytes.\n' +
              '</file>',
          },
        ],
      },
    ])
  })
})
