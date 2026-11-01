import { type ShellOptionSpec, parseShellOptionArgs } from './shellOptionArgs'

const BUN_PATH_FLAGS = new Set([
  '--cwd',
  '--config',
  '-c',
  '--env-file',
  '--preload',
  '--require',
  '-r',
  '--tsconfig-override',
])

/** File-valued options must participate in the normal workspace checks. */
const TEST_PATH_FLAGS = new Set([
  ...BUN_PATH_FLAGS,
  '--coverage-dir',
  '--reporter-outfile',
  '--timings',
])

const TEST_OPTIONS: ShellOptionSpec = {
  switches: new Set([
    '--isolate',
    '--no-isolate',
    '--no-env-file',
    '--no-orphans',
    '--update-snapshots',
    '-u',
    '--todo',
    '--only',
    '--pass-with-no-tests',
    '--concurrent',
    '--randomize',
    '--dots',
    '--only-failures',
    '--update-timings',
    '--check',
    '--watch',
    '--hot',
    '--help',
    '-h',
    '--version',
  ]),
  required: new Set([
    ...TEST_PATH_FLAGS,
    '--timeout',
    '--rerun-each',
    '--retry',
    '--seed',
    '--coverage-reporter',
    '--test-name-pattern',
    '-t',
    '--reporter',
    '--max-concurrency',
    '--path-ignore-patterns',
    '--parallel-delay',
    '--shard',
  ]),
  optional: new Set(['--coverage', '--bail', '--changed', '--parallel']),
}

/** Keep test files and file-valued flags; exclude names, counts, and patterns. */
export function bunTestPathValues(args: string[]) {
  const { operands, options, complete } = parseShellOptionArgs(
    args,
    TEST_OPTIONS,
  )
  const paths = options
    .filter((option) => TEST_PATH_FLAGS.has(option.flag))
    .flatMap((option) => (option.value ? [option.value] : []))
  // Relative operands need a different base when Bun changes directories.
  const changesDirectory = options.some((option) => option.flag === '--cwd')
  return {
    values: [...operands, ...paths],
    complete: complete && !changesDirectory,
  }
}
