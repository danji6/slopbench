/// <reference types="bun-types" />
import { resolveMessageTheme } from '@/lib/chat/message-theme'
import type { ThemeSnapshot } from '@sb/convex/types'
import { describe, expect, test } from 'bun:test'

const userTheme = { source: '#222222' } as ThemeSnapshot
const agentTheme = { source: '#333333' } as ThemeSnapshot

const options = { userTheme, agentTheme, followAgentThemeColor: false }

describe('live message theme', () => {
  test('uses the sending agent theme, independently of the follow toggle', () => {
    for (const followAgentThemeColor of [false, true]) {
      expect(
        resolveMessageTheme({
          ...options,
          fromAgent: true,
          followAgentThemeColor,
        }),
      ).toBe(agentTheme)
    }
  })

  test('follows the active agent for user messages only when enabled', () => {
    expect(
      resolveMessageTheme({
        ...options,
        fromAgent: false,
        followAgentThemeColor: true,
      }),
    ).toBe(agentTheme)
    expect(resolveMessageTheme({ ...options, fromAgent: false })).toBe(
      userTheme,
    )
  })

  test('uses the current user theme when following has no agent', () => {
    expect(
      resolveMessageTheme({
        ...options,
        fromAgent: false,
        agentTheme: undefined,
        followAgentThemeColor: true,
      }),
    ).toBe(userTheme)
  })

  test('a missing agent has no palette from a stored snapshot', () => {
    expect(
      resolveMessageTheme({
        ...options,
        fromAgent: true,
        agentTheme: undefined,
      }),
    ).toBeUndefined()
  })
})
