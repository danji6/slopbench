/// <reference types="bun-types" />
import { providerSchema } from '@/components/chat/entities/user/settings-schema'
import { describe, expect, test } from 'bun:test'

describe('provider settings schema', () => {
  test('requires a manually configured Qwen base URL', () => {
    const result = providerSchema.safeParse({
      id: 'qwen',
      enabled: true,
      models: [],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['baseURL'],
          message: 'Base URL is required for this provider',
        }),
      )
    }
  })

  test('accepts a manually configured Qwen base URL', () => {
    expect(
      providerSchema.safeParse({
        id: 'qwen',
        baseURL: 'https://qwen.example/v1',
        enabled: true,
        models: [],
      }).success,
    ).toBe(true)
  })
})
