import type { AgentAutoApprove, ToolApprovals } from '../../types'
import { GIT_VALUE_FLAGS, hasReadOnlyArguments } from './read_only_args'
import {
  DEFAULT_SAFE_SHELL_PATTERNS,
  ENV_ASSIGNMENT,
  INTERPRETER_PROGRAMS,
  WRAPPER_PROGRAMS,
} from './shell_config'
import { type ShellToken, splitShellChain, tokenizeShell } from './shell_parse'
import { analyzeShellPathCandidates } from './shell_path_analysis'

export { DEFAULT_SAFE_SHELL_PATTERNS } from './shell_config'
export {
  analyzeShellPathCandidates,
  extractPathCandidates,
} from './shell_path_analysis'
export type { ShellPathAnalysis } from './shell_path_analysis'

/**
 * Shell approval matching.
 *
 * A command is auto-approved only when every segment of its chain (split on
 * `&&`, `||`, `;`, `|`, `&` and quote-aware newlines) matches an allowed
 * pattern: either a built-in safe pattern or one the user approved for the
 * session. Patterns are `program` or `program subcommand` for multi-command
 * programs (`git status`, `npm view`, etc), so `git status` is different from
 * `git checkout`. Wrapper programs (sudo, xargs, timeout, etc) keep their name
 * in the pattern and unwrap to the real program (e.g. `rm` can't hide behind
 * an allowed wrapper). Some safe programs (find, sed) are additionally gated
 * on their arguments staying read-only (see read_only_args.ts).
 *
 * Commands containing command/process substitution or subshells are never
 * auto-approved. Output redirection is allowed only to /dev/null or another
 * file descriptor (e.g. `2>&1`).
 */
export interface ShellCommandAnalysis {
  /** Normalized and deduped pattern of a chain segment. */
  patterns: string[]
  /** Patterns covered by neither the built-in safe list nor the allowlist. */
  unapproved: string[]
  /** Whether this command was deemed unsafe to auto-approve. */
  unsafe: boolean
}

// TODO make the lists below more exhaustive

/** Programs whose first non-flag argument is part of the pattern. */
// prettier-ignore
const SUBCOMMAND_PROGRAMS = new Set([
  ...['git', 'gh', 'svn', 'hg', 'jj'],
  ...['npm', 'pnpm', 'yarn', 'bun', 'bunx', 'npx', 'deno', 'node', 'turbo','nx'],
  ...['python', 'python3', 'pip', 'pip3', 'uv', 'uvx', 'poetry'],
  ...['cargo', 'rustup', 'go', 'gem', 'bundle', 'rake', 'composer'],
  ...['mvn', 'gradle', 'dotnet', 'make', 'just', 'mise', 'asdf'],
  ...['docker', 'podman', 'docker-compose', 'kubectl', 'helm', 'terraform'],
  ...['aws', 'gcloud', 'az', 'fly', 'flyctl', 'vercel', 'netlify'],
  ...['supabase', 'firebase', 'convex', 'stripe'],
  ...['systemctl', 'apt', 'apt-get', 'dnf', 'yum', 'zypper', 'pacman', 'brew', 'snap', 'flatpak'],
])

/** Programs whose selected subcommands need a second subcommand for safety. */
const NESTED_SUBCOMMAND_PROGRAMS = new Map([
  ['bun', new Set(['pm'])],
  ['uv', new Set(['cache', 'pip', 'python', 'tool'])],
])

/** Global flags that consume the next token (e.g. `git -C dir`). */
const VALUE_FLAGS_BEFORE_SUBCOMMAND = new Map<string, ReadonlySet<string>>([
  ['git', GIT_VALUE_FLAGS],
])

const VERSION_OR_HELP = /^(-v|-V|--version|-h|--help)$/

export function analyzeShellCommand(
  command: string,
  allowlist: string[],
): ShellCommandAnalysis {
  const patterns: string[] = []
  const unapproved: string[] = []
  let unsafe = false

  for (const segment of splitShellChain(command)) {
    if (segment.hasRiskyRedirect) unsafe = true
    if (segment.hasSubstitution) {
      unsafe = true // Patterns derived from substitutions are unreliable
      continue
    }
    if (!segment.text) continue

    const { pattern, helpOnly, readOnlyArgs } = patternFromSegment(segment.text)
    if (!pattern) continue
    if (!patterns.includes(pattern)) patterns.push(pattern)

    const covered =
      helpOnly ||
      (readOnlyArgs && DEFAULT_SAFE_SHELL_PATTERNS.has(pattern)) ||
      allowlist.includes(pattern)
    if (!covered && !unapproved.includes(pattern)) unapproved.push(pattern)
  }

  return { patterns, unapproved, unsafe }
}

export function isShellCommandAutoApproved(
  command: string,
  allowlist: string[],
): boolean {
  const { patterns, unapproved, unsafe } = analyzeShellCommand(
    command,
    allowlist,
  )
  return !unsafe && patterns.length > 0 && unapproved.length === 0
}

export function isReadOnlyShellCommand(command: string): boolean {
  return isShellCommandAutoApproved(command, [])
}

/** Session approvals widened by the agent's own auto-approve allowlist. */
export function mergeToolApprovals(
  session: ToolApprovals | undefined,
  agent: AgentAutoApprove | undefined,
): ToolApprovals | undefined {
  if (!agent?.tools?.length && !agent?.shell?.length) return session
  return {
    tools: unionLists(session?.tools, agent.tools),
    shell: unionLists(session?.shell, agent.shell),
    paths: session?.paths,
  }
}

function unionLists(
  a: string[] | undefined,
  b: string[] | undefined,
): string[] | undefined {
  if (!a?.length) return b
  if (!b?.length) return a
  return [...new Set([...a, ...b])]
}

/** Whether a tool call should skip approval given the session allowlist. */
export function isToolAutoApproved(
  name: string,
  input: unknown,
  approvals: ToolApprovals | undefined,
): boolean {
  if (name === 'shell') {
    const command = (input as { command?: string } | undefined)?.command
    return (
      typeof command === 'string' &&
      isShellCommandAutoApproved(command, approvals?.shell ?? [])
    )
  }

  return (approvals?.tools ?? []).includes(name)
}

export function isPathAllowed(path: string, allowed: string[]): boolean {
  return allowed.some((entry) => path === entry || path.startsWith(`${entry}/`))
}

/** Drops redundant paths another entry already covers. */
export function foldPaths(paths: string[]): string[] {
  const unique = [...new Set(paths)]
  return unique.filter(
    (path) =>
      !unique.some((entry) => entry !== path && isPathAllowed(path, [entry])),
  )
}

const FORBIDDEN_PATH_SEGMENT = /(^|[\\/])\.git([\\/]|$)/

export function isPathForbidden(path: string): boolean {
  return FORBIDDEN_PATH_SEGMENT.test(path)
}

/** Whether an explicit path operand references a forbidden path. */
export function commandReferencesForbiddenPath(command: string): boolean {
  return analyzeShellPathCandidates(command).candidates.some(isPathForbidden)
}

/**
 * Index of the subcommand token in `rest`, skipping global flags and
 * values of flags that accept values (e.g. `git -C dir status` → `status`).
 */
function subcommandIndex(program: string, rest: ShellToken[]): number {
  const valueFlags = VALUE_FLAGS_BEFORE_SUBCOMMAND.get(program)
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!.value
    if (ENV_ASSIGNMENT.test(token)) continue
    // pacman is special as its operation is itself a flag (`-Q`)
    if (program === 'pacman') return i
    if (token.startsWith('-')) {
      if (valueFlags?.has(token)) i++ // skip the flag's value token
      continue
    }
    return i
  }
  return -1
}

/** Derive the allowlist pattern for one chain segment. */
function patternFromSegment(text: string) {
  const tokens = tokenizeShell(text)
  const names: string[] = []
  let program: string | null = null
  let i = 0

  while (i < tokens.length) {
    const token = tokens[i]!
    i++
    if (ENV_ASSIGNMENT.test(token.value)) continue
    names.push(token.value)
    if (
      INTERPRETER_PROGRAMS.has(token.value) &&
      hasQuotedInterpreterArgument(tokens.slice(i))
    ) {
      program = token.value
      break
    }
    if (!WRAPPER_PROGRAMS.has(token.value)) {
      program = token.value
      break
    }
    // Skip the wrapper's own flags / numeric args (e.g. `timeout 5`).
    while (
      i < tokens.length &&
      (tokens[i]!.value.startsWith('-') ||
        /^\d/.test(tokens[i]!.value) ||
        ENV_ASSIGNMENT.test(tokens[i]!.value))
    )
      i++
  }

  const rest = tokens.slice(i)
  if (program && SUBCOMMAND_PROGRAMS.has(program)) {
    const subIndex = subcommandIndex(program, rest)
    const sub = subIndex === -1 ? undefined : rest[subIndex]
    if (sub && !(INTERPRETER_PROGRAMS.has(program) && sub.quoted)) {
      names.push(sub.value)
      const nested = NESTED_SUBCOMMAND_PROGRAMS.get(program)
      if (nested?.has(sub.value)) {
        const nestedSub = rest
          .slice(subIndex + 1)
          .find(
            (token) =>
              !token.value.startsWith('-') && !ENV_ASSIGNMENT.test(token.value),
          )
        if (nestedSub) names.push(nestedSub.value)
      }
    }
  }

  const helpOnly =
    program !== null &&
    rest.length > 0 &&
    rest.every((token) => VERSION_OR_HELP.test(token.value))

  return {
    pattern: names.join(' '),
    helpOnly,
    readOnlyArgs:
      program === null ||
      hasReadOnlyArguments(
        program,
        rest.map((token) => token.value),
      ),
  }
}

function hasQuotedInterpreterArgument(args: ShellToken[]): boolean {
  return args.some((token) => token.quoted)
}
