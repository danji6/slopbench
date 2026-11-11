import type { PendingMessage } from '@/lib/chat/types'
import { toastError } from '@/lib/notifications'
import { useCallback, useState, useSyncExternalStore } from 'react'

type Submission = {
  sending: boolean
  failed: FailedSubmission[]
}

type FailedSubmission = { message: PendingMessage; restoreWhenEmpty?: boolean }
type DraftKey = string | symbol
type Submit = (message: PendingMessage) => void | Promise<void>
type SendOptions = {
  clearDraft?: () => () => boolean
  restoreWhenEmpty?: boolean
}

const idle: Submission = { sending: false, failed: [] }
// Keep in-flight and failed drafts available when the user switches chats.
const submissions = new Map<DraftKey, Submission>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function read(key: DraftKey) {
  return submissions.get(key) ?? idle
}

function update(key: DraftKey, state: Submission) {
  if (state.sending || state.failed.length > 0) submissions.set(key, state)
  else submissions.delete(key)
  listeners.forEach((listener) => listener())
}

/** Submits a snapshot and retains it for retry if the draft cannot be restored. */
export function useComposerSubmission(
  draftKey: string | undefined,
  submit: Submit,
) {
  const [fallbackKey] = useState(() => Symbol('composer'))
  const key = draftKey ?? fallbackKey
  const state = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => idle,
  )

  const isSending = useCallback(() => read(key).sending, [key])

  const discardFailed = useCallback(
    (message: PendingMessage) => {
      const current = read(key)
      const failed = current.failed.filter((item) => item.message !== message)
      if (failed.length !== current.failed.length)
        update(key, { ...current, failed })
    },
    [key],
  )

  const send = useCallback(
    async (message: PendingMessage, options?: SendOptions) => {
      const current = read(key)
      if (current.sending) return
      update(key, { ...current, sending: true })

      let restore: (() => boolean) | undefined
      let failed = current.failed
      try {
        restore = options?.clearDraft?.()
        await submit(message)
        failed = failed.filter((item) => item.message !== message)
      } catch (error) {
        if (!restore?.() && !failed.some((item) => item.message === message)) {
          failed = [
            ...failed,
            { message, restoreWhenEmpty: options?.restoreWhenEmpty },
          ]
        }
        toastError(error, 'Failed to send message')
      } finally {
        update(key, { sending: false, failed })
      }
    },
    [key, submit],
  )

  return {
    sending: state.sending,
    failed: state.failed[0],
    isSending,
    send,
    discardFailed,
  }
}
