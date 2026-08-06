/// <reference types="bun-types" />
import { shellBasename, shellLabel } from '@sb/core/shell/name'
import { shellToolDescription } from '@sb/core/types'
import { describe, expect, test } from 'bun:test'

describe('shellBasename', () => {
  test('reads both separators, whatever the host', () => {
    expect(shellBasename('/usr/bin/zsh')).toBe('zsh')
    expect(shellBasename('C:\\Program Files\\Git\\bin\\bash.exe')).toBe('bash')
  })

  test('keeps a bare name intact', () => {
    expect(shellBasename('bash')).toBe('bash')
    expect(shellBasename('PWSH.EXE')).toBe('pwsh')
  })
})

describe('shellLabel', () => {
  test('names the shells that go by another name', () => {
    expect(shellLabel('pwsh')).toBe('PowerShell')
    expect(shellLabel('C:\\Windows\\System32\\powershell.exe')).toBe(
      'PowerShell',
    )
    expect(shellLabel('C:\\Windows\\System32\\cmd.exe')).toBe('cmd.exe')
  })

  test('otherwise uses the program name', () => {
    expect(shellLabel('/bin/bash')).toBe('bash')
    expect(shellLabel('fish')).toBe('fish')
  })
})

describe('shellToolDescription', () => {
  test('names the shell the commands will run under', () => {
    expect(shellToolDescription('/usr/bin/fish')).toContain('with fish')
    expect(shellToolDescription('pwsh.exe')).toContain('with PowerShell')
  })

  test('names none when there is none to name', () => {
    expect(shellToolDescription()).toContain(
      'Run a shell command in the workspace.',
    )
  })
})
