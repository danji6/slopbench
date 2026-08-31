import { APP_ID } from '@sb/core/const'

import { createLocalStorageStore } from '../local-storage-store'

const STORAGE_KEY = `${APP_ID}-question-drafts`
const MAX_ENTRIES = 100

export type AnswerDraft = {
  selectedOptionIndices: number[]
  customAnswer: string
  note: string
  skipped: boolean
}

export type QuestionDraft = {
  questionIndex: number
  answers: AnswerDraft[]
}

type StoredDraft = QuestionDraft & { updatedAt: number }
type StoredDrafts = Record<string, StoredDraft>

const store = createLocalStorageStore<StoredDrafts>(STORAGE_KEY)

/** Namespaces a picker draft to one session and tool call. */
export function questionDraftKey(sessionId: string, toolCallId: string) {
  return `${sessionId}:${toolCallId}`
}

/** Reads a persisted picker draft, ignoring malformed response containers. */
export function getQuestionDraft(key: string): QuestionDraft | null {
  const value = store.get()[key]
  if (!value || !Array.isArray(value.answers)) return null
  return { questionIndex: value.questionIndex, answers: value.answers }
}

/** Persists a draft and evicts the oldest entries over the storage cap. */
export function setQuestionDraft(key: string, draft: QuestionDraft) {
  const entry = { ...draft, updatedAt: Date.now() }
  const next = { ...store.get(), [key]: entry }
  const keys = Object.keys(next)
  const patch: Partial<StoredDrafts> = { [key]: entry }
  if (keys.length > MAX_ENTRIES) {
    for (const stale of keys
      .sort((a, b) => next[a]!.updatedAt - next[b]!.updatedAt)
      .slice(0, keys.length - MAX_ENTRIES)) {
      patch[stale] = undefined
    }
  }
  store.set(patch)
}

/** Removes a settled or aborted tool call's picker draft. */
export function clearQuestionDraft(key: string) {
  store.set({ [key]: undefined } as Partial<StoredDrafts>)
}
