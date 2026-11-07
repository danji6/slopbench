import type { ActionCtx } from '@sb/convex/_generated/server'
import { _watch } from '@sb/convex/actions/tool/shellJobs'
import { describe, expect, test } from 'bun:test'
import { getFunctionName } from 'convex/server'
import { context } from '~/tests/helpers/shell-job'
import { pageSidecar } from '~/tests/helpers/shell-page'

describe('background completion pages', () => {
  test('reads one unread page after completion instead of reporting accumulated head/tail', async () => {
    const sidecar = pageSidecar(
      'a'.repeat(24_000) + 'b'.repeat(24_000) + 'last',
    )
    const mutations: Array<{ name: string; args: unknown }> = []
    const ctx = {
      runMutation: async (ref: never, args: unknown) => {
        const name = getFunctionName(ref)
        mutations.push({ name, args })
        if (name === 'shellJobs:_beginWindow')
          return {
            ...context,
            resume: { jobId: 'job-1', term: '', termOffset: 0 },
          }
      },
      runQuery: async (ref: never) => {
        expect(getFunctionName(ref)).toBe(
          'shellOutputDeliveries:_reportPosition',
        )
        return {
          offset: 24_000,
          ansiState: 'text',
          covered: [{ start: 0, end: 24_000 }],
        }
      },
    } as unknown as ActionCtx
    await _watch(
      ctx,
      { shellJobId: 'watch_1' as never, generation: 0 },
      sidecar,
    )
    expect(mutations.at(-1)).toMatchObject({
      name: 'shellJobs:_report',
      args: {
        output: {
          text: 'b'.repeat(24_000),
          status: 'done',
          range: {
            requestedOffset: 24_000,
            nextOffset: 48_000,
            hasMore: true,
          },
        },
      },
    })
  })

  test('does not publish a report after its watch was released', async () => {
    const sidecar = pageSidecar('finished')
    const calls: string[] = []
    const ctx = {
      runMutation: async (ref: never) => {
        const name = getFunctionName(ref)
        calls.push(name)
        if (name === 'shellJobs:_beginWindow')
          return {
            ...context,
            resume: { jobId: 'job-1', term: '', termOffset: 0 },
          }
      },
      runQuery: async () => null,
    } as unknown as ActionCtx
    await _watch(
      ctx,
      { shellJobId: 'watch_1' as never, generation: 0 },
      sidecar,
    )
    expect(calls).toEqual(['shellJobs:_beginWindow'])
  })
})
