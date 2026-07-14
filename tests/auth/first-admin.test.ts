/// <reference types="bun-types" />
import { getNewUserRole } from '@sb/convex/functions'
import { describe, expect, test } from 'bun:test'

function ctxWithUsers(users: unknown[]) {
  return {
    db: {
      query: (table: string) => {
        expect(table).toBe('users')
        return {
          first: async () => users[0] ?? null,
        }
      },
    },
  } as never
}

describe('getNewUserRole', () => {
  test('makes the first created user an admin', async () => {
    await expect(getNewUserRole(ctxWithUsers([]))).resolves.toBe('admin')
  })

  test('makes later users regular users', async () => {
    await expect(getNewUserRole(ctxWithUsers([{}]))).resolves.toBe('user')
  })
})
