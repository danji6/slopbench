/// <reference types="bun-types" />
import {
  dropShellJob,
  findShellJob,
  getShellJobs,
  retainShellJobs,
  subscribeToShellJobs,
} from '@/lib/chat/shell-jobs-store'
import type { ShellJobSummary } from '@sb/core/types/tools'
import { beforeEach, describe, expect, test } from 'bun:test'

function job(overrides: Partial<ShellJobSummary> = {}): ShellJobSummary {
  return {
    jobId: 'shell-1',
    command: 'sleep 30',
    status: 'running',
    exitCode: null,
    background: false,
    waiting: false,
    startedAt: 0,
    ...overrides,
  }
}

/** Counts calls so a test can tell one shared poller from several. */
function recorder(jobs: ShellJobSummary[] = [job()]) {
  let calls = 0
  return {
    calls: () => calls,
    list: async () => {
      calls += 1
      return { jobs }
    },
  }
}

const settle = () => Bun.sleep(20)

let release: (() => void)[] = []

beforeEach(() => {
  release.forEach((fn) => fn())
  release = []
})

function retain(sessionId: string | null, list: ReturnType<typeof recorder>) {
  const stop = retainShellJobs(sessionId, list.list)
  release.push(stop)
  return stop
}

describe('shell jobs store', () => {
  test('polls once for every consumer of a session', async () => {
    const source = recorder()
    retain('session-1', source)
    retain('session-1', source)
    retain('session-1', source)
    await settle()

    expect(source.calls()).toBe(1)
    expect(getShellJobs()).toHaveLength(1)
  })

  /** Shell blocks mount disabled all the time; they must not blank the list. */
  test('a consumer with no session leaves polling alone', async () => {
    const source = recorder()
    retain('session-1', source)
    await settle()

    retain(null, recorder([]))
    await settle()

    expect(getShellJobs()).toHaveLength(1)
  })

  test('stops polling once the last consumer releases', async () => {
    const source = recorder()
    const stop = retain('session-1', source)
    await settle()
    const before = source.calls()

    stop()
    await settle()

    expect(source.calls()).toBe(before)
    expect(getShellJobs()).toHaveLength(0)
  })

  test('drops a job locally until the sidecar agrees', async () => {
    const source = recorder()
    retain('session-1', source)
    await settle()

    let notified = 0
    const unsubscribe = subscribeToShellJobs(() => (notified += 1))

    dropShellJob('shell-1')
    expect(getShellJobs()).toHaveLength(0)
    expect(notified).toBe(1)

    unsubscribe()
  })

  test('switching sessions starts over', async () => {
    const first = recorder([job({ jobId: 'shell-1' })])
    const stop = retain('session-1', first)
    await settle()
    stop()

    const second = recorder([job({ jobId: 'shell-9' })])
    retain('session-2', second)
    await settle()

    expect(getShellJobs().map((entry) => entry.jobId)).toEqual(['shell-9'])
  })
})

describe('findShellJob', () => {
  test('an exact job id cannot be shadowed by a reused tool-call id', () => {
    const stale = job({
      jobId: 'shell-1',
      toolCallId: 'functions.shell:1',
      waiting: true,
    })
    const current = job({
      jobId: 'shell-2',
      toolCallId: 'functions.shell:1',
    })

    expect(
      findShellJob([stale, current], current.jobId, current.toolCallId),
    ).toBe(current)
  })

  test('a missing exact job never falls back to a reused tool-call id', () => {
    const stale = job({
      jobId: 'shell-1',
      toolCallId: 'functions.shell:1',
      waiting: true,
    })

    expect(
      findShellJob([stale], 'shell-missing', stale.toolCallId),
    ).toBeUndefined()
  })

  test('an unresolved part attaches to the newest matching live job', () => {
    const finished = job({
      jobId: 'shell-1',
      toolCallId: 'functions.shell:1',
      status: 'done',
    })
    const older = job({
      jobId: 'shell-2',
      toolCallId: 'functions.shell:1',
    })
    const current = job({
      jobId: 'shell-3',
      toolCallId: 'functions.shell:1',
    })

    expect(
      findShellJob([finished, older, current], undefined, current.toolCallId),
    ).toBe(current)
  })
})
