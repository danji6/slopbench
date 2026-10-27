import {
  backgroundShellJob,
  killSessionShellJobs,
  killShellJob,
  listShellJobs,
  pollShellJob,
  writeStdin,
} from '@sb/sidecar/shell/registry'
import { describe, expect, test } from 'bun:test'
import {
  isAlive,
  session,
  start,
  startReady,
  waitFor,
  waitForExit,
} from '~/tests/helpers/shell-registry'

process.env.CHAT_JOB_MODE = 'script'

process.env.CHAT_SIDECAR_DATA_DIR ??= process.cwd()

describe('job registry', () => {
  test('kills a running job', async () => {
    const { jobId } = await startReady()
    killShellJob(jobId, session.sessionId)

    const result = await waitForExit(jobId)
    expect(result.status).toBe('killed')
  })

  test.each([undefined, false])(
    'rejects terminal input when allowed is %s',
    async (allowInteractiveShells) => {
      const { jobId } = await start('read line; echo "got:$line"', {
        allowInteractiveShells,
      })
      const result = await waitForExit(jobId)
      expect(result.status).toBe('killed')
      expect(result.waiting).toBe(false)
      expect(result.output).toContain('Error: Interactive shells are disabled.')
      expect(result.output).toContain('Try a non-interactive command instead')
    },
  )

  test('rejects interactive background jobs without a watcher', async () => {
    const { jobId } = await start('read line', { background: true })
    const result = await waitForExit(jobId)
    expect(result.status).toBe('killed')
    expect(result.output).toContain('Interactive shells are disabled')
  })

  test('rejects alternate-screen programs by default', async () => {
    const { jobId } = await start("printf '\\033[?1049h'; sleep 30")
    const result = await waitForExit(jobId)
    expect(result.status).toBe('killed')
    expect(result.waiting).toBe(false)
    expect(result.output).toContain('Interactive shells are disabled')
  })

  test('allows commands with supplied input by default', async () => {
    const { jobId } = await start(
      'printf "ping\\n" | { read line; echo "got:$line"; }',
    )
    const result = await waitForExit(jobId)
    expect(result.status).toBe('done')
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('got:ping')
  })

  test('times out a job', async () => {
    const { jobId } = await start('sleep 30', { timeoutSeconds: 0.3 })

    const result = await waitForExit(jobId)
    expect(result.status).toBe('timeout')
  })

  test('reports non-zero exit codes without failing', async () => {
    const { jobId } = await start('exit 3')

    const result = await waitForExit(jobId)
    expect(result.status).toBe('done')
    expect(result.exitCode).toBe(3)
  })

  test('rejects jobs from the wrong session', async () => {
    const { jobId } = await start('echo x')
    expect(() => pollShellJob(jobId, 'other-session', 0)).toThrow('not found')
    await waitForExit(jobId)
  })

  test('killSessionShellJobs with includeBackground stops background jobs too', async () => {
    const fg = await startReady()
    const bg = await startReady({ background: true })

    const killed = killSessionShellJobs(session.sessionId, true)
    expect(killed).toBeGreaterThanOrEqual(2)

    const fgResult = await waitForExit(fg.jobId)
    expect(fgResult.status).toBe('killed')
    const bgResult = await waitForExit(bg.jobId)
    expect(bgResult.status).toBe('killed')
  })

  test('backgroundShellJob detaches a foreground job so cleanup spares it', async () => {
    const fg = await startReady()

    backgroundShellJob(fg.jobId, session.sessionId)
    expect(pollShellJob(fg.jobId, session.sessionId, 0).background).toBe(true)

    // Foreground-only cleanup must now leave it running.
    killSessionShellJobs(session.sessionId, false)
    expect(pollShellJob(fg.jobId, session.sessionId, 0).status).toBe('running')

    killShellJob(fg.jobId, session.sessionId)
    await waitForExit(fg.jobId)
  })

  test('kill_session only reaps the jobs of the owner it is given', async () => {
    const mine = await startReady({ owner: 'turn-1' })
    const theirs = await startReady({ owner: 'turn-2' })

    expect(killSessionShellJobs(session.sessionId, false, 'turn-1')).toBe(1)

    expect((await waitForExit(mine.jobId)).status).toBe('killed')
    expect(pollShellJob(theirs.jobId, session.sessionId, 0).status).toBe(
      'running',
    )

    killShellJob(theirs.jobId, session.sessionId)
    await waitForExit(theirs.jobId)
  })

  test('runs commands with pagers disabled', async () => {
    const { jobId } = await start(
      'echo "pager=$PAGER git=$GIT_PAGER prompt=$GIT_TERMINAL_PROMPT"',
    )

    const result = await waitForExit(jobId)
    expect(result.output).toContain('pager=cat git=cat prompt=0')
  })

  /**
   * A job that pipes into a pager only dies if the whole group is signalled:
   * the leader defers the signal until its child exits. Every spawn mode goes
   * through the same `killProcessTree`; node-pty cannot run under bun, so this
   * covers it in script mode.
   */
  test('killing a job takes its children down with it', async () => {
    const { jobId } = await start('sleep 30 & echo "child:$!"; wait')
    await waitFor(() =>
      pollShellJob(jobId, session.sessionId, 0).chunk.includes('child:'),
    )

    const child = Number(
      /child:(\d+)/.exec(pollShellJob(jobId, session.sessionId, 0).chunk)?.[1],
    )
    expect(child).toBeGreaterThan(0)

    killShellJob(jobId, session.sessionId)
    expect((await waitForExit(jobId)).status).toBe('killed')
    await waitFor(() => !isAlive(child))
  })

  test('reports waiting while a job blocks reading stdin', async () => {
    const { jobId } = await start('read line; echo "got:$line"', {
      allowInteractiveShells: true,
    })
    await waitFor(() => pollShellJob(jobId, session.sessionId, 0).waiting)

    writeStdin(jobId, session.sessionId, 'ping\n')
    const result = await waitForExit(jobId)
    expect(result.waiting).toBe(false)
    expect(result.status).toBe('done')
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('got:ping')
  })

  test('reports waiting when a job enters the alternate screen', async () => {
    const { jobId } = await start("printf '\\033[?1049h'; sleep 30", {
      allowInteractiveShells: true,
    })
    await waitFor(() => pollShellJob(jobId, session.sessionId, 0).waiting)

    killShellJob(jobId, session.sessionId)
    const result = await waitForExit(jobId)
    expect(result.waiting).toBe(false)
  })

  test("ignores a nested job's private terminal wait", async () => {
    const { jobId } = await start(
      "script -qefc 'read line' /dev/null >/dev/null 2>&1 & sleep 30",
    )
    await Bun.sleep(1_500)

    expect(pollShellJob(jobId, session.sessionId, 0).waiting).toBe(false)

    killShellJob(jobId, session.sessionId)
    await waitForExit(jobId)
  })

  test('kill_session only kills foreground jobs', async () => {
    const fg = await startReady()
    const bg = await startReady({ background: true })

    const killed = killSessionShellJobs(session.sessionId, false)
    expect(killed).toBeGreaterThanOrEqual(1)

    const fgResult = await waitForExit(fg.jobId)
    expect(fgResult.status).toBe('killed')

    const summaries = listShellJobs(session.sessionId)
    const bgSummary = summaries.find((job) => job.jobId === bg.jobId)
    expect(bgSummary?.status).toBe('running')

    killShellJob(bg.jobId, session.sessionId)
    await waitForExit(bg.jobId)
  })
})
