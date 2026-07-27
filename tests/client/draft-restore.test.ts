/// <reference types="bun-types" />
import type { DraftRestoreRequest } from '@/lib/chat/draft-restore'
import {
  draftRestore,
  isDraftPending,
  keepDraftRestore,
  releaseDraftRestore,
  requestDraftRestore,
} from '@/lib/chat/draft-restore'
import { afterEach, describe, expect, test } from 'bun:test'

type Answered = { applied: string[]; discarded: string[] }

function makeRequest(key: string, log: Answered): DraftRestoreRequest {
  return {
    key,
    label: key,
    apply: () => log.applied.push(key),
    discard: () => log.discarded.push(key),
  }
}

function emptyLog(): Answered {
  return { applied: [], discarded: [] }
}

/** Waits out the task a withdrawal is deferred by. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve))
}

/** The queue is module state; a leaked request would leak into the next test. */
afterEach(() => {
  let pending = draftRestore.peek()
  while (pending) {
    draftRestore.dismiss(pending)
    pending = draftRestore.peek()
  }
})

describe('draft restore queue', () => {
  test('asks one request at a time, in the order they arrived', () => {
    // Nested editors restore in sequence — a prompt only mounts once the
    // settings form holding it has been restored — so the questions queue
    // rather than stacking a second dialog over the first.
    const log = emptyLog()
    requestDraftRestore(makeRequest('settings', log))
    requestDraftRestore(makeRequest('prompt', log))

    expect(draftRestore.peek()?.key).toBe('settings')
    draftRestore.restore(draftRestore.peek()!)
    expect(draftRestore.peek()?.key).toBe('prompt')
    draftRestore.restore(draftRestore.peek()!)

    expect(log.applied).toEqual(['settings', 'prompt'])
    expect(draftRestore.peek()).toBeUndefined()
  })

  test('replaces a re-request for the same key instead of asking twice', () => {
    // Effects re-run; the same editor must not queue itself a second time.
    const log = emptyLog()
    requestDraftRestore(makeRequest('prompt', log))
    requestDraftRestore(makeRequest('prompt', log))

    draftRestore.restore(draftRestore.peek()!)

    expect(log.applied).toEqual(['prompt'])
    expect(draftRestore.peek()).toBeUndefined()
  })

  test('deletes the draft when the user refuses it', () => {
    const log = emptyLog()
    const request = makeRequest('prompt', log)
    requestDraftRestore(request)

    draftRestore.discard(request)

    expect(log.discarded).toEqual(['prompt'])
    expect(log.applied).toEqual([])
  })

  test('leaves the draft alone when the question is dismissed', () => {
    // Escape is not an answer: the draft survives to be offered again.
    const log = emptyLog()
    const request = makeRequest('prompt', log)
    requestDraftRestore(request)

    draftRestore.dismiss(request)

    expect(log).toEqual(emptyLog())
    expect(draftRestore.peek()).toBeUndefined()
  })

  test('ignores a second answer rather than consuming the next request', () => {
    // The dialog reports a button press *and* the close that follows it; the
    // second must not silently answer for whoever is next in line.
    const log = emptyLog()
    const first = makeRequest('settings', log)
    requestDraftRestore(first)
    requestDraftRestore(makeRequest('prompt', log))

    draftRestore.discard(first)
    draftRestore.dismiss(first)

    expect(log.discarded).toEqual(['settings'])
    expect(draftRestore.peek()?.key).toBe('prompt')
  })

  test('takes back the question of an editor that closed', async () => {
    // Answering it would restore the draft into an editor the user has left.
    const log = emptyLog()
    requestDraftRestore(makeRequest('plan', log))

    releaseDraftRestore('plan')
    await settle()

    expect(log).toEqual(emptyLog())
    expect(draftRestore.peek()).toBeUndefined()
  })

  test('keeps the question of an editor that only remounted', async () => {
    // StrictMode tears the editor down and builds it again in one commit, and
    // editors ask once: a question retired here is never raised again.
    const log = emptyLog()
    requestDraftRestore(makeRequest('prompt', log))

    releaseDraftRestore('prompt')
    keepDraftRestore('prompt')
    await settle()

    expect(draftRestore.peek()?.key).toBe('prompt')
  })

  test('withdrawing one question leaves the others queued', async () => {
    const log = emptyLog()
    requestDraftRestore(makeRequest('settings', log))
    requestDraftRestore(makeRequest('prompt', log))

    releaseDraftRestore('settings')
    await settle()

    expect(draftRestore.peek()?.key).toBe('prompt')
  })

  test('reports a draft as pending until its question is answered', () => {
    // What keeps a draft alive while it is being asked about. The editor
    // mounting behind the dialog rewrites its document as it parses it, reports
    // itself unchanged, and would otherwise delete the very draft on offer —
    // leaving it to live in memory only, gone from storage before the answer.
    const log = emptyLog()
    const request = makeRequest('plan', log)
    expect(isDraftPending('plan')).toBe(false)

    requestDraftRestore(request)
    expect(isDraftPending('plan')).toBe(true)

    draftRestore.restore(request)
    expect(isDraftPending('plan')).toBe(false)
  })

  test('reports a draft as pending while it waits behind another', () => {
    // Only the head is on screen, but a queued question is just as unanswered.
    const log = emptyLog()
    requestDraftRestore(makeRequest('settings', log))
    requestDraftRestore(makeRequest('prompt', log))

    expect(isDraftPending('prompt')).toBe(true)
  })

  test('stops reporting a withdrawn question as pending', async () => {
    const log = emptyLog()
    requestDraftRestore(makeRequest('plan', log))

    releaseDraftRestore('plan')
    await settle()

    expect(isDraftPending('plan')).toBe(false)
  })

  test('notifies subscribers when a request arrives and when it is answered', () => {
    const log = emptyLog()
    let notifications = 0
    const unsubscribe = draftRestore.subscribe(() => notifications++)

    const request = makeRequest('prompt', log)
    requestDraftRestore(request)
    draftRestore.restore(request)
    unsubscribe()
    requestDraftRestore(makeRequest('after', log))

    expect(notifications).toBe(2)
  })
})
