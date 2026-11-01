import type { ShellOptionSpec } from './shellOptionArgs'

export type RunnerOptionSpec = ShellOptionSpec & {
  paths: ReadonlySet<string>
  blocked: ReadonlySet<string>
  packages: ReadonlySet<string>
}

type RunnerOptions = {
  switches?: string[]
  data?: string[]
  paths?: string[]
  blocked?: string[]
  packages?: string[]
  optional?: string[]
}

/** Describe runner option values separately from the program it launches. */
export function runnerOptions(options: RunnerOptions): RunnerOptionSpec {
  return {
    switches: new Set(options.switches),
    required: new Set([
      ...(options.data ?? []),
      ...(options.paths ?? []),
      ...(options.packages ?? []),
    ]),
    optional: new Set(options.optional),
    paths: new Set(options.paths),
    blocked: new Set(options.blocked),
    packages: new Set(options.packages),
    stopAtOperand: true,
  }
}

const JS_SWITCHES = [
  '--silent',
  '-s',
  '--verbose',
  '--if-present',
  '--ignore-scripts',
  '--offline',
  '--yes',
  '-y',
  '--no',
  '--no-install',
  '--help',
  '-h',
]
const JS_PATHS = ['--userconfig', '--globalconfig', '--cache', '--env-file']
const JS_SELECTION = [
  '--prefix',
  '--cwd',
  '--dir',
  '-C',
  '--workspace',
  '-w',
  '--filter',
  '-F',
]

export const JS_RUNNER_OPTIONS = runnerOptions({
  switches: [
    ...JS_SWITCHES,
    '--recursive',
    '-r',
    '--parallel',
    '--stream',
    '--workspaces',
    '--include-workspace-root',
    '--workspace-root',
    '-W',
    '--top-level',
    '-T',
    '--binaries-only',
    '-B',
    '--bun',
    '--no-env-file',
  ],
  data: [...JS_SELECTION, '--registry', '--reporter'],
  paths: [
    ...JS_PATHS,
    '--config',
    '-c',
    '--preload',
    '--require',
    '--tsconfig-override',
    '--script-shell',
  ],
  packages: ['--package', '-p'],
  blocked: [
    ...JS_SELECTION,
    '--recursive',
    '-r',
    '--workspaces',
    '--include-workspace-root',
    '--workspace-root',
    '-W',
    '--top-level',
    '-T',
    '-c',
  ],
  optional: ['--color', '--inspect', '--inspect-brk'],
})

export const UV_RUNNER_OPTIONS = runnerOptions({
  switches: [
    '--locked',
    '--frozen',
    '--no-sync',
    '--no-project',
    '--isolated',
    '--active',
    '--no-dev',
    '--only-dev',
    '--all-extras',
    '--all-groups',
    '--no-default-groups',
    '--no-editable',
    '--all-packages',
    '--no-env-file',
    '--offline',
    '--no-config',
    '--no-progress',
    '--no-cache',
    '-n',
    '--managed-python',
    '--no-managed-python',
    '--no-python-downloads',
    '--no-index',
    '--no-sources',
    '--refresh',
    '--reinstall',
    '--upgrade',
    '-U',
    '--quiet',
    '-q',
    '--verbose',
    '-v',
    '--help',
    '-h',
    '--module',
    '-m',
    '--script',
    '-s',
    '--gui-script',
  ],
  data: [
    '--extra',
    '--no-extra',
    '--group',
    '--no-group',
    '--only-group',
    '--package',
    '--color',
    '--index',
    '--default-index',
    '--index-url',
    '-i',
    '--extra-index-url',
    '--index-strategy',
    '--resolution',
    '--prerelease',
    '--link-mode',
    '--keyring-provider',
    '--exclude-newer',
    '--upgrade-package',
    '-P',
  ],
  paths: [
    '--directory',
    '--project',
    '--config-file',
    '--env-file',
    '--cache-dir',
    '--with-editable',
    '--with-requirements',
    '--constraints',
    '-c',
    '--build-constraints',
    '-b',
    '--overrides',
  ],
  packages: ['--with', '-w', '--from', '--python', '-p'],
  blocked: [
    '--directory',
    '--project',
    '--package',
    '--all-packages',
    '--script',
    '-s',
    '--gui-script',
  ],
})

export const POETRY_RUNNER_OPTIONS = runnerOptions({
  switches: [
    '--quiet',
    '-q',
    '--verbose',
    '-v',
    '--no-interaction',
    '-n',
    '--no-ansi',
    '--ansi',
    '--no-cache',
    '--no-plugins',
    '--help',
    '-h',
  ],
  paths: ['--directory', '-C', '--project', '-P'],
  blocked: ['--directory', '-C', '--project', '-P'],
})
