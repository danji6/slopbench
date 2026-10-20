import { type ShellOptionSpec, parseShellOptionArgs } from './shellOptionArgs'

const HEAD_OPTIONS: ShellOptionSpec = {
  switches: new Set([
    '-q',
    '-v',
    '-z',
    '--quiet',
    '--silent',
    '--verbose',
    '--zero-terminated',
    '--help',
    '--version',
  ]),
  required: new Set(['-n', '-c', '--lines', '--bytes']),
  legacyCount: true,
}

const LS_OPTIONS: ShellOptionSpec = {
  switches: new Set([
    ...'aAbBcCdDfFgGhHiklLmNnopqQrRsStuvUxXZ1'
      .split('')
      .map((flag) => `-${flag}`),
    '--all',
    '--almost-all',
    '--author',
    '--escape',
    '--directory',
    '--dired',
    '--full-time',
    '--file-type',
    '--group-directories-first',
    '--human-readable',
    '--si',
    '--dereference-command-line',
    '--dereference-command-line-symlink-to-dir',
    '--inode',
    '--kibibytes',
    '--dereference',
    '--numeric-uid-gid',
    '--literal',
    '--hide-control-chars',
    '--show-control-chars',
    '--quote-name',
    '--reverse',
    '--recursive',
    '--size',
    '--context',
    '--zero',
    '--help',
    '--version',
    '--ignore-backups',
  ]),
  required: new Set([
    '-I',
    '-T',
    '-w',
    '--ignore',
    '--hide',
    '--block-size',
    '--format',
    '--indicator-style',
    '--quoting-style',
    '--sort',
    '--time',
    '--time-style',
    '--tabsize',
    '--width',
  ]),
  optional: new Set(['--color', '--hyperlink', '--classify']),
}

/** Extract file operands from common read-only listing commands. */
export function listingPathValues(program: string, args: string[]) {
  const spec = program === 'head' ? HEAD_OPTIONS : LS_OPTIONS
  const { operands, complete } = parseShellOptionArgs(args, spec)
  // ls treats '-' as a filename; head treats it as standard input.
  const values =
    program === 'ls'
      ? operands.map((value) => (value === '-' ? './-' : value))
      : operands.filter((value) => value !== '-')
  return { values, complete }
}
