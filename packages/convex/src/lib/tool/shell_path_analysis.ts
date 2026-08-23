import { isReadOnlySedScript } from './read_only_args'
import {
  DEFAULT_SAFE_SHELL_PATTERNS,
  ENV_ASSIGNMENT,
  INTERPRETER_PROGRAMS,
  WRAPPER_PROGRAMS,
  isInterpreterPayloadFlag,
} from './shell_config'
import { type ShellToken, splitShellChain, tokenizeShell } from './shell_parse'

export interface ShellPathAnalysis {
  /** Explicit path operands found in the command. */
  candidates: string[]
  /** Whether every segment's explicit path operands were classified. */
  complete: boolean
}

/** Pattern arguments that are data rather than paths. */
// prettier-ignore
const PATTERN_ARG_FLAGS = new Set([
  ...['-path', '-ipath', '-wholename', '-iwholename', '-name', '-iname'],
  ...['-regex', '-iregex', '-lname', '-ilname'],
  ...['-e', '--regexp', '-g', '--glob', '--iglob'],
  ...['--exclude', '--exclude-dir', '--include', '--include-dir'],
])

const MAX_PATH_CANDIDATES = 32
const DEFAULT_SAFE_PROGRAMS = new Set(
  [...DEFAULT_SAFE_SHELL_PATTERNS].map((pattern) => pattern.split(' ')[0]!),
)

/** Safe programs whose arguments are data rather than filesystem operands. */
// prettier-ignore
const NO_PATH_PROGRAMS = new Set([
  ...['echo', 'printf', 'true', 'false', 'sleep', 'seq', 'expr', 'pwd'],
  ...['which', 'whereis', 'type', 'tr', 'column'],
  ...['date', 'cal', 'uptime', 'whoami', 'id', 'groups', 'hostname'],
  ...['uname', 'arch', 'nproc', 'free', 'ps'],
])

const GREP_PROGRAMS = new Set(['grep', 'egrep', 'fgrep', 'rg'])
const GREP_PATTERN_FLAGS = new Set(['-e', '--regexp'])
const GREP_PATTERN_FILE_FLAGS = new Set(['-f', '--file'])
const GREP_FILTER_FLAGS = new Set([
  '--exclude',
  '--exclude-dir',
  '--include',
  '--include-dir',
])
// prettier-ignore
const GREP_VALUE_FLAGS = new Set([
  ...['-A', '-B', '-C', '-m'],
  ...['--after-context', '--before-context', '--context', '--max-count'],
  ...['--binary-files', '--devices', '--directories', '--label'],
  ...['--encoding', '--engine', '--max-depth', '--max-filesize'],
  ...['--path-separator', '--replace', '--sort', '--sortr', '--type'],
  ...['--type-add', '--type-clear', '--type-not'],
])
const RG_PATTERN_FLAGS = new Set(['-g', '--glob', '--iglob'])
const RG_FILES_MODES = new Set(['--files', '--files-with-matches'])

interface SegmentPathAnalysis {
  values: string[]
  complete: boolean
}

interface Invocation {
  program: string
  args: ShellToken[]
  values: string[]
}

/** Analyze the explicit path operands of a shell command. */
export function analyzeShellPathCandidates(command: string): ShellPathAnalysis {
  const candidates: string[] = []
  let complete = true

  for (const segment of splitShellChain(command)) {
    if (segment.hasSubstitution) {
      complete = false
      continue
    }
    if (!segment.text) continue

    const analysis = pathValuesFromSegment(segment.text)
    complete &&= analysis.complete
    for (const value of analysis.values) addPathCandidate(candidates, value)
  }

  if (candidates.length > MAX_PATH_CANDIDATES) complete = false
  return { candidates: candidates.slice(0, MAX_PATH_CANDIDATES), complete }
}

export function extractPathCandidates(command: string): string[] {
  return analyzeShellPathCandidates(command).candidates
}

function pathValuesFromSegment(text: string): SegmentPathAnalysis {
  const invocation = invocationFromTokens(tokenizeShell(text))
  if (!invocation) return { values: [], complete: false }

  const { program, args, values } = invocation
  if (
    INTERPRETER_PROGRAMS.has(program) ||
    hasInterpreterPayload(program, args)
  ) {
    return {
      values: [...values, ...interpreterPathValues(program, args)],
      complete: true,
    }
  }
  if (program === 'sed') return mergePathValues(values, sedPathValues(args))
  if (GREP_PROGRAMS.has(program)) {
    return mergePathValues(values, grepPathValues(program, args))
  }
  if (program === 'find') return mergePathValues(values, findPathValues(args))
  if (NO_PATH_PROGRAMS.has(program)) return { values, complete: true }
  if (!DEFAULT_SAFE_PROGRAMS.has(program)) {
    return {
      values: [...values, ...genericPathValues(args)],
      complete: false,
    }
  }

  return { values: [...values, ...genericPathValues(args)], complete: true }
}

/** Locate the effective program through simple wrapper and env prefixes. */
function invocationFromTokens(tokens: ShellToken[]): Invocation | null {
  const values: string[] = []
  let i = 0

  while (i < tokens.length) {
    const token = tokens[i++]!
    const envPath = envAssignmentValue(token.value)
    if (envPath !== null) {
      values.push(envPath)
      continue
    }

    if (INTERPRETER_PROGRAMS.has(token.value)) {
      return { program: token.value, args: tokens.slice(i), values }
    }
    if (!WRAPPER_PROGRAMS.has(token.value)) {
      return { program: token.value, args: tokens.slice(i), values }
    }

    while (i < tokens.length) {
      const prefix = tokens[i]!.value
      const prefixEnv = envAssignmentValue(prefix)
      if (prefixEnv !== null) {
        values.push(prefixEnv)
        i++
      } else if (/^\d/.test(prefix)) {
        i++
      } else if (prefix.startsWith('-')) {
        return null
      } else break
    }
  }

  return null
}

function mergePathValues(
  prefix: string[],
  analysis: SegmentPathAnalysis,
): SegmentPathAnalysis {
  return {
    values: [...prefix, ...analysis.values],
    complete: analysis.complete,
  }
}

function envAssignmentValue(token: string): string | null {
  if (!ENV_ASSIGNMENT.test(token)) return null
  return token.slice(token.indexOf('=') + 1)
}

function interpreterPathValues(program: string, args: ShellToken[]): string[] {
  const values: string[] = []

  for (let i = 0; i < args.length; i++) {
    const token = args[i]!
    if (isInterpreterPayloadFlag(program, token.value)) {
      if (!token.value.includes('=')) i++
      continue
    }
    if (!token.quoted && !token.value.startsWith('-')) values.push(token.value)
  }

  return values
}

function hasInterpreterPayload(program: string, args: ShellToken[]): boolean {
  return args.some((token) => isInterpreterPayloadFlag(program, token.value))
}

function sedPathValues(args: ShellToken[]): SegmentPathAnalysis {
  const values: string[] = []
  const scripts: string[] = []
  let hasScriptSource = false
  let complete = true

  for (let i = 0; i < args.length; i++) {
    const value = args[i]!.value
    if (value === '--') {
      if (!hasScriptSource && i + 1 < args.length) {
        scripts.push(args[++i]!.value)
      }
      values.push(...args.slice(i + 1).map((token) => token.value))
      break
    }
    if (value === '-e' || value === '--expression') {
      if (i + 1 >= args.length) return { values, complete: false }
      scripts.push(args[++i]!.value)
      hasScriptSource = true
      continue
    }
    if (value.startsWith('--expression=')) {
      scripts.push(value.slice('--expression='.length))
      hasScriptSource = true
      continue
    }
    if (value === '-f' || value === '--file') {
      if (i + 1 >= args.length) return { values, complete: false }
      values.push(args[++i]!.value)
      hasScriptSource = true
      complete = false
      continue
    }
    if (value.startsWith('--file=')) {
      values.push(value.slice('--file='.length))
      hasScriptSource = true
      complete = false
      continue
    }
    if (value.startsWith('-') && value.length > 1) {
      const attached = sedAttachedExpression(value)
      if (attached !== null) {
        scripts.push(attached)
        hasScriptSource = true
      }
      continue
    }
    if (!hasScriptSource) {
      scripts.push(value)
      hasScriptSource = true
    } else values.push(value)
  }

  if (scripts.some((script) => !isReadOnlySedScript(script))) complete = false
  return { values, complete }
}

function sedAttachedExpression(value: string): string | null {
  for (let i = 1; i < value.length; i++) {
    if (value[i] === 'e') return value.slice(i + 1) || null
    if (!'nrEszu'.includes(value[i]!)) return null
  }
  return null
}

function grepPathValues(
  program: string,
  args: ShellToken[],
): SegmentPathAnalysis {
  const values: string[] = []
  let hasPattern =
    program === 'rg' && args.some((token) => RG_FILES_MODES.has(token.value))
  let complete = true

  for (let i = 0; i < args.length; i++) {
    const value = args[i]!.value
    if (value === '--') {
      const rest = args.slice(i + 1)
      if (!hasPattern && rest.length > 0) {
        values.push(...rest.slice(1).map((token) => token.value))
      } else values.push(...rest.map((token) => token.value))
      break
    }

    const equal = value.indexOf('=')
    const flag = equal === -1 ? value : value.slice(0, equal)
    const inlineValue = equal === -1 ? null : value.slice(equal + 1)
    const patternFlag =
      GREP_PATTERN_FLAGS.has(flag) ||
      GREP_FILTER_FLAGS.has(flag) ||
      (program === 'rg' && RG_PATTERN_FLAGS.has(flag))

    if (patternFlag) {
      hasPattern ||= GREP_PATTERN_FLAGS.has(flag)
      if (inlineValue === null) {
        if (i + 1 >= args.length) complete = false
        else i++
      }
      continue
    }
    if (GREP_PATTERN_FILE_FLAGS.has(flag)) {
      hasPattern = true
      const file = inlineValue ?? args[++i]?.value
      if (file === undefined) complete = false
      else values.push(file)
      continue
    }
    if (GREP_VALUE_FLAGS.has(flag)) {
      if (inlineValue === null && !hasAttachedShortValue(value)) {
        if (i + 1 >= args.length) complete = false
        else i++
      }
      continue
    }
    if (value.startsWith('-')) continue
    if (!hasPattern) hasPattern = true
    else values.push(value)
  }

  return { values, complete }
}

function hasAttachedShortValue(value: string): boolean {
  return /^-[ABCMm].+/.test(value)
}

function findPathValues(args: ShellToken[]): SegmentPathAnalysis {
  const values: string[] = []
  const complete = !args.some((token) =>
    /^(-delete|-exec(dir)?|-ok(dir)?|-fprint0?|-fprintf|-fls)$/.test(
      token.value,
    ),
  )

  for (const token of args) {
    const value = token.value
    if (value === '-H' || value === '-L' || value === '-P') continue
    if (value.startsWith('-') || value === '!' || value === '(') break
    values.push(value)
  }

  return { values, complete }
}

function genericPathValues(args: ShellToken[]): string[] {
  const values: string[] = []
  let skipNext = false

  for (const token of args) {
    const value = token.value
    if (skipNext) {
      skipNext = false
      continue
    }
    if (PATTERN_ARG_FLAGS.has(value)) {
      skipNext = true
      continue
    }
    const equal = value.indexOf('=')
    if (value.startsWith('--') && equal !== -1) {
      if (!PATTERN_ARG_FLAGS.has(value.slice(0, equal))) {
        values.push(value.slice(equal + 1))
      }
    } else {
      const envPath = envAssignmentValue(value)
      if (envPath !== null) values.push(envPath)
      else if (!value.startsWith('-')) values.push(value)
    }
  }

  return values
}

function addPathCandidate(candidates: string[], value: string) {
  if (!value || value.startsWith('-') || candidates.includes(value)) return
  if (/^[<>]+$/.test(value)) return
  candidates.push(value)
}
