import {
  JS_RUNNER_OPTIONS,
  POETRY_RUNNER_OPTIONS,
  type RunnerOptionSpec,
  UV_RUNNER_OPTIONS,
} from './runnerOptions'
import { type RunnerPrefix, parseRunnerPrefix } from './runnerPrefix'
import type { ShellToken } from './shellParse'

export type RunnerInvocation = RunnerPrefix & {
  parts: string[]
  target?: ShellToken
  kind: 'script' | 'exec' | 'bun-test'
}

const JS_PROGRAMS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const DIRECT_EXECUTORS = new Set(['npx', 'bunx', 'uvx'])
const SCRIPT_ALIASES = new Set([
  'test',
  'format',
  'lint',
  'typecheck',
  'build',
  'check',
  'dev',
  'start',
])

/** Share runner boundaries between command permission matching and path checks. */
export function parseRunnerInvocation(
  program: string,
  args: ShellToken[],
): RunnerInvocation | null {
  const invocation = runnerInvocation(program, args)
  return program === 'npm' && invocation ? npmArguments(invocation) : invocation
}

/** npm consumes options until `--`, including options after a task's name. */
function npmArguments(invocation: RunnerInvocation): RunnerInvocation {
  if (invocation.terminated) return invocation
  const boundary = invocation.args.findIndex((token) => token.value === '--')
  const ownArgs =
    boundary === -1 ? invocation.args : invocation.args.slice(0, boundary)
  const forwarded = boundary === -1 ? [] : invocation.args.slice(boundary + 1)
  return {
    ...invocation,
    args: [...ownArgs, ...forwarded],
    complete:
      invocation.complete &&
      !ownArgs.some((token) => token.value.startsWith('-')),
    terminated: boundary !== -1,
  }
}

function runnerInvocation(
  program: string,
  args: ShellToken[],
): RunnerInvocation | null {
  const spec = optionSpec(program)
  if (!spec) return null

  const prefix = parseRunnerPrefix(args, spec)
  if (DIRECT_EXECUTORS.has(program)) return launchedTarget([], prefix, 'exec')

  const command = prefix.args[0]?.value
  if (!command) return null

  const rest = { ...prefix, args: prefix.args.slice(1) }

  if (program === 'uv') {
    return uvInvocation(command, rest)
  }
  if (program === 'poetry') {
    return command === 'run'
      ? launchedTarget(['run'], rest, 'exec', spec)
      : null
  }
  if (command === 'run' || command === 'run-script') {
    const invocation = launchedTarget([command], rest, 'script', spec)
    // Yarn can resolve colon-named scripts in a different workspace.
    const crossWorkspace =
      program === 'yarn' && invocation.parts.at(-1)?.includes(':')
    return { ...invocation, complete: invocation.complete && !crossWorkspace }
  }

  const executesCommand =
    command === 'exec' && ['npm', 'pnpm'].includes(program)
  const downloadsCommand =
    command === 'dlx' && ['pnpm', 'yarn'].includes(program)
  if (
    executesCommand ||
    downloadsCommand ||
    (program === 'bun' && command === 'x')
  ) {
    return launchedTarget([command], rest, 'exec', spec)
  }
  if (program === 'bun' && command === 'test') {
    return { ...rest, parts: ['test'], kind: 'bun-test' }
  }

  const alias = SCRIPT_ALIASES.has(command)
  const npmAlias = ['test', 't', 'start', 'stop', 'restart'].includes(command)
  if (program === 'npm' ? npmAlias : alias) {
    return { ...rest, parts: [command], kind: 'script' }
  }

  return null
}

function optionSpec(program: string): RunnerOptionSpec | null {
  if (program === 'uv' || program === 'uvx') return UV_RUNNER_OPTIONS
  if (program === 'poetry') return POETRY_RUNNER_OPTIONS
  if (JS_PROGRAMS.has(program) || DIRECT_EXECUTORS.has(program))
    return JS_RUNNER_OPTIONS
  return null
}

function uvInvocation(
  command: string,
  prefix: RunnerPrefix,
): RunnerInvocation | null {
  if (command === 'run')
    return launchedTarget(['run'], prefix, 'exec', UV_RUNNER_OPTIONS)
  if (command !== 'tool' || prefix.args[0]?.value !== 'run') return null
  return launchedTarget(
    ['tool', 'run'],
    {
      ...prefix,
      args: prefix.args.slice(1),
    },
    'exec',
    UV_RUNNER_OPTIONS,
  )
}

function launchedTarget(
  parts: string[],
  prefix: RunnerPrefix,
  kind: 'script' | 'exec',
  spec?: RunnerOptionSpec,
): RunnerInvocation {
  const parsed = spec ? parseRunnerPrefix(prefix.args, spec) : prefix
  const target = parsed.args[0]
  return {
    parts: target ? [...parts, target.value] : parts,
    args: parsed.args.slice(1),
    values: spec ? [...prefix.values, ...parsed.values] : parsed.values,
    complete: prefix.complete && parsed.complete && !!target,
    terminated: prefix.terminated || parsed.terminated,
    target: kind === 'exec' ? target : undefined,
    kind,
  }
}
