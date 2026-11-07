import { positionFromRanges } from '@sb/convex/model/shellOutputDeliveries'
import {
  executeShellOutput,
  shellToModelOutput,
} from '@sb/convex/model/tool/shell'
import type { ShellReadPosition } from '@sb/convex/model/tool/shellContracts'
import { SHELL_PAGE_CHARS } from '@sb/core/shell/output-page'
import type { ShellOutputRange } from '@sb/core/types/tools'
import { describe, expect, test } from 'bun:test'
import { collect, context } from '~/tests/helpers/shell-job'
import { pageSidecar } from '~/tests/helpers/shell-page'

describe('bounded shell output', () => {
  test('bounds an oversized live frame and leaves the rest for the next read', async () => {
    const sidecar = pageSidecar('start', 'running')
    sidecar.frames.push({ text: 'x'.repeat(SHELL_PAGE_CHARS), status: 'done' })
    const first = (
      await collect(executeShellOutput(context, { jobId: 'job-1' }, sidecar))
    ).at(-1)!
    expect(first.text.length).toBe(SHELL_PAGE_CHARS)
    expect(first.range!.hasMore).toBe(true)
    const second = (
      await collect(
        executeShellOutput(
          context,
          { jobId: 'job-1' },
          {
            ...sidecar,
            readPosition: positionFromRanges([first.range!]),
          },
        ),
      )
    ).at(-1)!
    expect(first.text + second.text).toBe(
      'start' + 'x'.repeat(SHELL_PAGE_CHARS),
    )
    expect(second.status).toBe('done')
  })

  test('reconnects from consumed output without duplicating its prefix', async () => {
    const sidecar = pageSidecar('', 'running')
    sidecar.frames.push({ text: 'b', status: 'done' })
    let connections = 0
    async function* openStream(...args: Parameters<typeof sidecar.openStream>) {
      connections += 1
      if (connections === 1) {
        sidecar.ring.append('a')
        yield {
          event: 'chunk',
          data: JSON.stringify({ text: 'a', nextOffset: 1 }),
        }
        return
      }
      yield* sidecar.openStream(...args)
    }
    const outputs = await collect(
      executeShellOutput(
        context,
        { jobId: 'job-1' },
        {
          ...sidecar,
          openStream,
          pollIntervalMs: 1,
        },
      ),
    )
    expect(outputs.at(-1)?.text).toBe('ab')
    expect(sidecar.offsets).toEqual([1])
  })

  test('aborted reads never produce delivery metadata and release their stream', async () => {
    const sidecar = pageSidecar('', 'running')
    sidecar.frames.push({ text: 'working' })
    const ac = new AbortController()
    const outputs = executeShellOutput(
      context,
      { jobId: 'job-1' },
      { ...sidecar, abortSignal: ac.signal },
    )
    const first = await outputs.next()
    expect(first.value?.range).toBeUndefined()
    ac.abort()
    await expect(outputs.next()).rejects.toThrow('aborted')
    expect(sidecar.closed()).toBe(1)
  })

  test('pages a completed log without dropping text or changing terminal scrollback', async () => {
    const text = 'first\n' + 'x'.repeat(SHELL_PAGE_CHARS * 2) + '\nlast  '
    const sidecar = pageSidecar(text)
    const ranges: ShellOutputRange[] = []
    let combined = ''
    for (let page = 0; page < 3; page++) {
      const outputs = await collect(
        executeShellOutput(
          context,
          { jobId: 'job-1' },
          {
            ...sidecar,
            readPosition: positionFromRanges(ranges),
          },
        ),
      )
      const result = outputs.at(-1)!
      expect(result.status).toBe('done')
      expect(
        result.range!.nextOffset - result.range!.startOffset,
      ).toBeLessThanOrEqual(SHELL_PAGE_CHARS)
      expect(result.range!.hasMore).toBe(page < 2)
      expect(result.term).toBe(text.slice(-48_000))
      combined += result.text
      ranges.push(result.range!)
    }
    expect(combined).toBe(text)
    const [empty] = await collect(
      executeShellOutput(
        context,
        { jobId: 'job-1' },
        {
          ...sidecar,
          readPosition: positionFromRanges(ranges),
        },
      ),
    )
    expect(empty.text).toBe('')
    expect(empty.range!.hasMore).toBe(false)
    expect(shellToModelOutput({ output: empty }).value).toContain(
      'No new output',
    )
  })

  test('waits for live output and closes its stream on completion or deadline', async () => {
    const sidecar = pageSidecar('start\n', 'running')
    sidecar.frames.push({ text: 'finished\n', status: 'done', exitCode: 7 })
    const outputs = await collect(
      executeShellOutput(context, { jobId: 'job-1', wait_seconds: 1 }, sidecar),
    )
    expect(outputs.at(-1)).toMatchObject({
      status: 'done',
      exitCode: 7,
      text: 'start\nfinished\n',
    })
    expect(sidecar.closed()).toBe(1)

    const silent = pageSidecar('', 'running')
    const waiting = await collect(
      executeShellOutput(
        context,
        { jobId: 'job-1', wait_seconds: 0.01 },
        silent,
      ),
    )
    expect(waiting.at(-1)).toMatchObject({
      status: 'background',
      text: '',
      range: { nextOffset: 0 },
    })
    expect(silent.closed()).toBe(1)
  })

  test('returns immediately on a live full page and leaves its suffix unread', async () => {
    const sidecar = pageSidecar('a'.repeat(SHELL_PAGE_CHARS + 50), 'running')
    const [result] = await collect(
      executeShellOutput(context, { jobId: 'job-1' }, sidecar),
    )
    expect(result.text.length).toBe(SHELL_PAGE_CHARS)
    expect(result).toMatchObject({
      status: 'background',
      range: { hasMore: true, nextOffset: SHELL_PAGE_CHARS },
    })
    expect(sidecar.offsets).toEqual([])
  })

  test('replays explicitly without advancing automatic coverage', async () => {
    const sidecar = pageSidecar('old\nnew\n')
    const readPosition: ShellReadPosition = {
      offset: 4,
      ansiState: 'text',
      covered: [{ start: 0, end: 4 }],
    }
    const [fresh] = await collect(
      executeShellOutput(
        context,
        { jobId: 'job-1', wait_seconds: 0 },
        { ...sidecar, readPosition },
      ),
    )
    expect(fresh.text).toBe('new\n')
    const [replay] = await collect(
      executeShellOutput(
        context,
        { jobId: 'job-1', offset: 0 },
        { ...sidecar, readPosition },
      ),
    )
    expect(replay.text).toBe('old\nnew\n')
    expect(positionFromRanges([replay.range!]).offset).toBe(0)
    const [pastEnd] = await collect(
      executeShellOutput(context, { jobId: 'job-1', offset: 100 }, sidecar),
    )
    expect(pastEnd.range).toMatchObject({
      requestedOffset: 100,
      startOffset: 8,
      nextOffset: 8,
      hasMore: false,
    })
  })

  test('reports evicted prefixes and advances only through the page it returned', async () => {
    const sidecar = pageSidecar('a'.repeat(1_010_000))
    const [result] = await collect(
      executeShellOutput(context, { jobId: 'job-1' }, sidecar),
    )
    expect(result.range).toMatchObject({
      startOffset: 10_000,
      nextOffset: 34_000,
      hasMore: true,
      unavailable: [{ start: 0, end: 10_000 }],
    })
    expect(positionFromRanges([result.range!]).offset).toBe(34_000)
    expect(shellToModelOutput({ output: result }).value).toContain(
      'no longer retained',
    )
  })

  test('fills a selected-history gap without resending the following covered range', async () => {
    const sidecar = pageSidecar('abcdefghij')
    const [result] = await collect(
      executeShellOutput(
        context,
        { jobId: 'job-1' },
        {
          ...sidecar,
          readPosition: {
            offset: 0,
            ansiState: 'text',
            covered: [{ start: 4, end: 10 }],
          },
        },
      ),
    )
    expect(result.text).toBe('abcd')
    expect(result.range).toMatchObject({ nextOffset: 4, hasMore: false })
  })

  test('preserves Unicode and ANSI state across page boundaries', async () => {
    const text = 'a'.repeat(SHELL_PAGE_CHARS - 1) + '😀\x1b[31mred\x1b[0m'
    const sidecar = pageSidecar(text)
    const [first] = await collect(
      executeShellOutput(context, { jobId: 'job-1' }, sidecar),
    )
    expect(first.range!.nextOffset).toBe(SHELL_PAGE_CHARS - 1)
    const [second] = await collect(
      executeShellOutput(
        context,
        { jobId: 'job-1' },
        {
          ...sidecar,
          readPosition: positionFromRanges([first.range!]),
        },
      ),
    )
    expect(first.text + second.text).toBe(
      'a'.repeat(SHELL_PAGE_CHARS - 1) + '😀red',
    )

    const ansi = pageSidecar(
      'b'.repeat(SHELL_PAGE_CHARS - 2) + '\x1b[31mred\x1b[0m',
    )
    const [before] = await collect(
      executeShellOutput(context, { jobId: 'job-1' }, ansi),
    )
    expect(before.range!.ansiState).toBe('csi')
    const [after] = await collect(
      executeShellOutput(
        context,
        { jobId: 'job-1' },
        {
          ...ansi,
          readPosition: positionFromRanges([before.range!]),
        },
      ),
    )
    expect(after.text).toBe('red')

    const osc = pageSidecar('lead\x1b]' + 'hidden'.repeat(5_000) + '\x1b\\tail')
    const [oscFirst] = await collect(
      executeShellOutput(context, { jobId: 'job-1' }, osc),
    )
    expect(oscFirst.range!.ansiState).toBe('osc')
    const [oscLast] = await collect(
      executeShellOutput(
        context,
        { jobId: 'job-1' },
        {
          ...osc,
          readPosition: positionFromRanges([oscFirst.range!]),
        },
      ),
    )
    expect(oscFirst.text + oscLast.text).toBe('leadtail')
  })
})
