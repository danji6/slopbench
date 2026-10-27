/// <reference types="bun-types" />
import { shellInvocation } from '@sb/sidecar/shell/system-shell'
import { describe, expect, test } from 'bun:test'

/** Paths, not bare names, so nothing depends on the host's own PATH. */
const POSIX = '/usr/bin/bash'
const POWERSHELL = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
const CMD = 'C:\\Windows\\System32\\cmd.exe'

describe('shellInvocation', () => {
  test('picks the invocation style from the program name', () => {
    expect(shellInvocation('echo hi', POSIX)).toEqual({
      file: POSIX,
      args: ['-lc', 'echo hi'],
    })
    expect(shellInvocation('echo hi', CMD)).toEqual({
      file: CMD,
      args: ['/d', '/s', '/c', 'echo hi'],
    })
  })

  test('encodes for PowerShell, which would otherwise re-parse the quoting', () => {
    const { file, args } = shellInvocation('Write-Output "a b"', POWERSHELL)

    expect(file).toBe(POWERSHELL)
    expect(args.slice(0, 4)).toEqual([
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
    ])
    expect(Buffer.from(args[4], 'base64').toString('utf16le')).toBe(
      'Write-Output "a b"',
    )
  })

  test('names the shell it could not find, rather than failing at spawn', () => {
    expect(() => shellInvocation('echo hi', 'definitely-not-a-shell')).toThrow(
      'Shell not found: definitely-not-a-shell',
    )
  })

  test('an empty override falls through to the platform default', () => {
    expect(shellInvocation('echo hi', '   ').file).toBe(
      shellInvocation('echo hi').file,
    )
  })
})
