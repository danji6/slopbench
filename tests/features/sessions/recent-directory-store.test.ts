import type * as RecentDirectoryStore from '@/lib/chat/recent-directory-store'
import { APP_ID } from '@sb/core/const'
import { afterEach, beforeAll, expect, test } from 'bun:test'
import { setupDom } from '~/tests/setup/dom'

setupDom()

const STORAGE_KEY = `${APP_ID}-recent-directories`
let store: typeof RecentDirectoryStore

beforeAll(async () => {
  store = await import('@/lib/chat/recent-directory-store')
})

afterEach(() => {
  localStorage.removeItem(STORAGE_KEY)
})

test('recent selections are unique, newest first, and bounded', () => {
  for (let index = 0; index < 12; index++) {
    store.rememberDirectory(`/projects/${index}`)
  }
  store.rememberDirectory('/projects/5')

  const expected = [5, 11, 10, 9, 8, 7, 6, 4, 3, 2].map(
    (index) => `/projects/${index}`,
  )
  expect(store.getRecentDirectories()).toEqual(expected)
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
    paths: expected,
  })
})

test('confirmed selections notify subscribers immediately', () => {
  let notifications = 0
  const unsubscribe = store.subscribeRecentDirectories(() => notifications++)
  store.rememberDirectory('/other')

  expect(store.getRecentDirectories()[0]).toBe('/other')
  expect(notifications).toBe(1)
  unsubscribe()
})
