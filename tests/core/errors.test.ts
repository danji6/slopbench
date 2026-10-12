/// <reference types="bun-types" />
import { errorMessage, errorMessageChain } from '@sb/core/utils/errors'
import { describe, expect, test } from 'bun:test'
import { ConvexError } from 'convex/values'

describe('error messages', () => {
  test('reads a plain error', () => {
    expect(errorMessage(new Error('Workspace is gone'))).toBe(
      'Workspace is gone',
    )
  })

  test('reads a string', () => {
    expect(errorMessage('Workspace is gone')).toBe('Workspace is gone')
  })

  test('prefers a ConvexError payload over its decorated message', () => {
    const thrown = new ConvexError({ message: 'No workspace configured' })
    thrown.message = `[CONVEX M(sessions:bind)] [Request ID: abc123] Server Error Uncaught ConvexError: ${JSON.stringify(thrown.data)} Called by client`

    expect(errorMessage(thrown)).toBe('No workspace configured')
  })

  test('unwraps a serialized ConvexError out of a transport message', () => {
    const message =
      '[CONVEX A(actions/workspaces:listDirectories)] [Request ID: fb584898b8b83285] ' +
      'Server Error Uncaught ConvexError: ' +
      '{"message":"ENOENT: no such file or directory, realpath \'/home/x/gone\'","code":500} ' +
      'Called by client'

    expect(errorMessage(new Error(message))).toBe(
      "ENOENT: no such file or directory, realpath '/home/x/gone'",
    )
  })

  test('strips the transport framing off a non-Convex server error', () => {
    const message =
      '[CONVEX M(chat:send)] [Request ID: abc123] Server Error\n' +
      'Uncaught Error: Something broke\n' +
      '    at handler (../convex/chat.ts:12:3)\n' +
      '  Called by client'

    expect(errorMessage(new Error(message))).toBe('Something broke')
  })

  test('reads the sidecar error envelope', () => {
    expect(errorMessage('{"error":"ENOENT: no such file or directory"}')).toBe(
      'ENOENT: no such file or directory',
    )
    expect(
      errorMessage({ error: 'Path escapes the configured workspace' }),
    ).toBe('Path escapes the configured workspace')
  })

  test('extracts a saved Convex error with inline stack frames', () => {
    const message =
      'Uncaught ConvexError: {"message":"A skill with this name is already installed","code":409} at error (../../packages/convex/src/errors.ts:7:4) at commitInstalledSkill (../../packages/convex/src/model/skills/completion.ts:81:12) at async complete (../../packages/convex/src/model/skills/completion.ts:19:31)'
    expect(errorMessage(message)).toBe(
      'A skill with this name is already installed',
    )
  })

  test('keeps natural prose containing at', () => {
    expect(errorMessage('Could not find a skill at this path')).toBe(
      'Could not find a skill at this path',
    )
  })

  test('preserves stack-like prose and braces inside a serialized message', () => {
    const message = 'Failed at handler (input {"name":"review"})'
    expect(
      errorMessage(
        `Uncaught ConvexError: ${JSON.stringify({ message })} at complete (skills.ts:1:1)`,
      ),
    ).toBe(message)
  })

  test('falls back to statusText', () => {
    expect(errorMessage({ statusText: 'Bad Gateway' })).toBe('Bad Gateway')
  })

  test('has no message to read', () => {
    expect(errorMessage(undefined)).toBeUndefined()
    expect(errorMessage(null)).toBeUndefined()
    expect(errorMessage(42)).toBeUndefined()
    expect(errorMessage({})).toBeUndefined()
    expect(errorMessage(new Error(''))).toBeUndefined()
  })

  test('joins a cause chain without repeating itself', () => {
    const cause = new Error('socket hang up')
    const outer = new Error('Provider request failed', { cause })

    expect(errorMessageChain(outer)).toBe(
      'Provider request failed socket hang up',
    )
    expect(
      errorMessageChain(new Error('boom', { cause: new Error('boom') })),
    ).toBe('boom')
  })
})
