/// <reference types="bun-types" />
import { resolveMessageTheme } from '@/lib/chat/message-theme'
import type { ThemeSnapshot } from '@sb/convex/types'
import { describe, expect, test } from 'bun:test'

const snapshot = { source: '#111111' } as ThemeSnapshot
const userTheme = { source: '#222222' } as ThemeSnapshot
const agentTheme = { source: '#333333' } as ThemeSnapshot

describe('message theme', () => {
  test('temporarily follows the active agent for user messages', () => {
    expect(
      resolveMessageTheme({
        fromAgent: false,
        followAgentThemeColor: true,
        snapshot,
        userTheme,
        agentTheme,
      }),
    ).toBe(agentTheme)
  })

  test('restores the message snapshot when following is disabled', () => {
    expect(
      resolveMessageTheme({
        fromAgent: false,
        followAgentThemeColor: false,
        snapshot,
        userTheme,
        agentTheme,
      }),
    ).toBe(snapshot)
  })

  test('does not change agent messages or require an agent theme', () => {
    expect(
      resolveMessageTheme({
        fromAgent: true,
        followAgentThemeColor: true,
        snapshot,
        userTheme,
        agentTheme,
      }),
    ).toBe(snapshot)
    expect(
      resolveMessageTheme({
        fromAgent: false,
        followAgentThemeColor: true,
        snapshot,
        userTheme,
      }),
    ).toBe(snapshot)
  })
})
