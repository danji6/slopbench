import type { AgentAutoApprove, ToolApprovals } from '../../types'
import { GIT_VALUE_FLAGS, hasReadOnlyArguments } from './read_only_args'

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

interface ChainSegment {
  text: string
  hasSubstitution: boolean
  hasRiskyRedirect: boolean
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

/**
 * Programs that execute their arguments. They keep their name in the pattern
 * and pattern extraction continues with the wrapped program.
 */
// prettier-ignore
const WRAPPER_PROGRAMS = new Set([
  ...['sudo', 'doas', 'env', 'xargs', 'nohup', 'timeout', 'stdbuf'],
  ...['time', 'nice', 'ionice', 'command', 'builtin', 'exec', 'eval'],
  ...['sh', 'bash', 'zsh', 'fish', 'dash'],
])

/** Patterns that never need approval (they still respect path approval). */
// prettier-ignore
export const DEFAULT_SAFE_SHELL_PATTERNS: ReadonlySet<string> = new Set([
  // Shell basics
  ...['cd', 'echo', 'printf', 'true', 'false', 'sleep', 'seq', 'expr'],
  // Files & paths (read-only; find is argument-gated)
  ...['ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'stat', 'file', 'du', 'df'],
  ...['tree', 'basename', 'dirname', 'realpath', 'readlink', 'find'],
  ...['which', 'whereis', 'type'],
  // Text processing (pure filters; sed is argument-gated)
  ...['grep', 'egrep', 'fgrep', 'rg', 'sort', 'uniq', 'cut', 'tr', 'column'],
  ...['sed'],
  ...['diff', 'cmp', 'comm', 'jq', 'yq', 'xxd', 'hexdump', 'strings'],
  // Checksums
  ...['md5sum', 'sha1sum', 'sha256sum', 'sha512sum', 'cksum', 'b2sum'],
  // System info
  ...['date', 'cal', 'uptime', 'whoami', 'id', 'groups', 'hostname'],
  ...['uname', 'arch', 'nproc', 'free', 'ps'],
  // git (read-only subcommands; remote is argument-gated)
  ...['git status', 'git log', 'git diff', 'git show', 'git blame'],
  ...['git shortlog', 'git describe', 'git rev-parse', 'git rev-list'],
  ...['git ls-files', 'git ls-tree', 'git cat-file', 'git grep'],
  ...['git show-ref', 'git count-objects', 'git remote'],
  // Package managers (read-only subcommands)
  ...['npm ls', 'npm list', 'npm view', 'npm info', 'npm outdated'],
  ...['npm ping', 'npm root', 'npm prefix'],
  ...['pnpm ls', 'pnpm list', 'pnpm outdated', 'pnpm why'],
  ...['yarn list', 'yarn info', 'yarn why'],
  ...['bun outdated', 'bun pm ls', 'bun pm why'],
  ...['uv tree', 'uv pip check', 'uv pip list'],
  ...['uv pip show', 'uv pip tree', 'uv python list', 'uv tool list'],
  ...['uv cache dir'],
  ...['pip list', 'pip show', 'pip check', 'pip freeze', 'pip inspect'],
  ...['pip debug', 'pip index', 'pip search'],
  ...['pip3 list', 'pip3 show', 'pip3 check', 'pip3 freeze', 'pip3 inspect'],
  ...['pip3 debug', 'pip3 index', 'pip3 search'],
  ...['pacman -Q', 'pacman -Qi', 'pacman -Ql', 'pacman -Qk'],
  ...['pacman -Qo', 'pacman -Qq', 'pacman -Qs', 'pacman -Qu'],
  ...['pacman -T', 'pacman -V'],
  ...['cargo check', 'cargo tree', 'cargo metadata', 'cargo search'],
  ...['go version', 'go env', 'go list', 'go vet'],
  ...['brew list', 'brew info', 'brew outdated', 'brew search', 'brew deps'],
  ...['apt list', 'apt search', 'apt-cache'],
  // Containers / infra (read-only subcommands)
  ...['docker ps', 'docker images', 'docker logs', 'docker inspect'],
  ...['docker version', 'docker info', 'podman ps', 'podman images'],
  ...['kubectl get', 'kubectl describe', 'kubectl logs', 'kubectl explain'],
  ...['kubectl version'],
  ...['systemctl status', 'systemctl list-units', 'systemctl is-active'],
  ...['systemctl show'],
])

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const VERSION_OR_HELP = /^(-v|-V|--version|-h|--help)$/

export function analyzeShellCommand(
  command: string,
  allowlist: string[],
): ShellCommandAnalysis {
  const patterns: string[] = []
  const unapproved: string[] = []
  let unsafe = false

  for (const segment of splitChain(command)) {
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

const FORBIDDEN_PATH_SEGMENT = /(^|[\\/])\.git([\\/]|$)/

export function isPathForbidden(path: string): boolean {
  return FORBIDDEN_PATH_SEGMENT.test(path)
}

/**
 * Flags whose argument is a match/exclusion pattern rather than a path the
 * command reads or writes (e.g. a `find -not -path` glob that skips .git, or
 * `grep --exclude-dir=.git`). Their arguments never count as path references.
 */
// prettier-ignore
const PATTERN_ARG_FLAGS = new Set([
  ...['-path', '-ipath', '-wholename', '-iwholename', '-name', '-iname'],
  ...['-regex', '-iregex', '-lname', '-ilname'],
  ...['-e', '--regexp', '-g', '--glob', '--iglob'],
  ...['--exclude', '--exclude-dir', '--include', '--include-dir'],
])

/** Values of one segment that may reference paths (pattern args skipped). */
function pathValuesFromSegment(text: string): string[] {
  const values: string[] = []
  let skipNext = false

  for (const token of tokenize(text)) {
    if (skipNext) {
      skipNext = false
      continue
    }
    if (PATTERN_ARG_FLAGS.has(token)) {
      skipNext = true
      continue
    }
    const eq = token.indexOf('=')
    if (token.startsWith('--') && eq !== -1) {
      if (!PATTERN_ARG_FLAGS.has(token.slice(0, eq))) {
        values.push(token.slice(eq + 1))
      }
    } else if (ENV_ASSIGNMENT.test(token)) {
      values.push(token.slice(eq + 1))
    } else values.push(token)
  }

  return values
}

/** Whether any token of a shell command references a forbidden path. */
export function commandReferencesForbiddenPath(command: string): boolean {
  return splitChain(command).some(
    (segment) =>
      segment.text && pathValuesFromSegment(segment.text).some(isPathForbidden),
  )
}

const MAX_PATH_CANDIDATES = 32

/** Extract tokens from a command that could reference workspace paths. */
export function extractPathCandidates(command: string): string[] {
  const candidates: string[] = []

  for (const segment of splitChain(command)) {
    if (segment.hasSubstitution || !segment.text) continue
    for (const value of pathValuesFromSegment(segment.text)) {
      addPathCandidate(candidates, value.startsWith('-') ? '' : value)
    }
  }

  return candidates.slice(0, MAX_PATH_CANDIDATES)
}

function addPathCandidate(candidates: string[], value: string) {
  if (!value || candidates.includes(value)) return
  // Redirection leftovers (`<`, `<<`) are operators, not paths.
  if (/^[<>]+$/.test(value)) return
  candidates.push(value)
}

/** Split a command into chain segments, tracking unsafe constructs. */
function splitChain(command: string): ChainSegment[] {
  const segments: ChainSegment[] = []
  let text = ''
  let hasSubstitution = false
  let hasRiskyRedirect = false

  const flush = () => {
    const trimmed = text.trim()
    if (trimmed || hasSubstitution || hasRiskyRedirect)
      segments.push({ text: trimmed, hasSubstitution, hasRiskyRedirect })
    text = ''
    hasSubstitution = false
    hasRiskyRedirect = false
  }

  let i = 0
  while (i < command.length) {
    const ch = command[i]!
    const next = command[i + 1]

    if (ch === "'") {
      const end = command.indexOf("'", i + 1)
      text += command.slice(i, end === -1 ? undefined : end + 1)
      i = end === -1 ? command.length : end + 1
    } else if (ch === '\\') {
      text += command.slice(i, i + 2)
      i += 2
    } else if (ch === '"') {
      const scanned = scanDoubleQuoted(command, i)
      text += scanned.text
      hasSubstitution ||= scanned.hasSubstitution
      i = scanned.next
    } else if (
      ch === '`' ||
      (ch === '$' && next === '(') ||
      ((ch === '<' || ch === '>') && next === '(') ||
      ch === '(' ||
      ch === ')'
    ) {
      hasSubstitution = true
      text += ch
      i++
    } else if (ch === '<' && next === '<') {
      // Treat heredoc as opaque data
      const heredoc = consumeHeredoc(command, i)
      if (heredoc.consumed) {
        i = heredoc.next
        flush()
      } else {
        text += command.slice(i, heredoc.next)
        i = heredoc.next
      }
    } else if (ch === '\n' || ch === ';') {
      flush()
      i++
    } else if (ch === '|') {
      flush()
      i += next === '|' ? 2 : 1
    } else if (ch === '&' && next === '>') {
      const redirect = consumeRedirect(command, i + 1)
      hasRiskyRedirect ||= redirect.risky
      i = redirect.next
    } else if (ch === '&') {
      flush()
      i += next === '&' ? 2 : 1
    } else if (ch === '>') {
      // Strip a preceding bare fd digit (e.g. the `2` of `2> file`).
      text = text.replace(/(^|\s)\d+$/, '$1')
      const redirect = consumeRedirect(command, i)
      hasRiskyRedirect ||= redirect.risky
      i = redirect.next
    } else {
      text += ch
      i++
    }
  }
  flush()

  return segments
}

function scanDoubleQuoted(command: string, start: number) {
  let hasSubstitution = false
  let i = start + 1
  while (i < command.length && command[i] !== '"') {
    if (command[i] === '\\') i += 2
    else {
      if (command[i] === '`' || (command[i] === '$' && command[i + 1] === '('))
        hasSubstitution = true
      i++
    }
  }
  const next = Math.min(i + 1, command.length)
  return { text: command.slice(start, next), hasSubstitution, next }
}

/** Consume a `>`-style redirect; safe only to /dev/null or another fd. */
function consumeRedirect(command: string, i: number) {
  let j = i + 1
  if (command[j] === '>') j++

  if (command[j] === '&') {
    j++
    let digits = ''
    while (/\d/.test(command[j] ?? '')) digits += command[j++]
    if (digits) return { next: j, risky: false }
  }

  while (command[j] === ' ' || command[j] === '\t') j++
  let target = ''
  while (j < command.length && !/[\s|&;<>]/.test(command[j]!))
    target += command[j++]

  return { next: j, risky: target !== '/dev/null' }
}

/**
 * Consume a heredoc body.
 *
 * @returns the index after the terminator line, or after the whole
 * command if no terminator is found.
 */
function consumeHeredoc(command: string, i: number) {
  let j = i + 2
  const stripLeadingTabs = command[j] === '-'
  if (stripLeadingTabs) j++

  while (command[j] === ' ' || command[j] === '\t') j++

  let delimiter = ''
  if (command[j] === "'" || command[j] === '"') {
    const quote = command[j]
    const end = command.indexOf(quote, j + 1)
    delimiter = command.slice(j + 1, end === -1 ? undefined : end)
    j = end === -1 ? command.length : end + 1
  } else {
    while (j < command.length && !/[\s|&;<>]/.test(command[j]!)) {
      if (command[j] === '\\' && j + 1 < command.length) {
        delimiter += command[j + 1]
        j += 2
      } else {
        delimiter += command[j]
        j++
      }
    }
  }

  if (!delimiter) return { next: j, consumed: false }

  const bodyStart = command.indexOf('\n', j)
  if (bodyStart === -1) return { next: command.length, consumed: true }

  const terminator = new RegExp(
    `^${stripLeadingTabs ? '\\t*' : ''}${escapeRegExp(delimiter)}$`,
  )

  let pos = bodyStart + 1
  while (pos <= command.length) {
    const lineEnd = command.indexOf('\n', pos)
    const end = lineEnd === -1 ? command.length : lineEnd
    if (terminator.test(command.slice(pos, end))) {
      return { next: Math.min(end + 1, command.length), consumed: true }
    }
    if (lineEnd === -1) break
    pos = lineEnd + 1
  }

  return { next: command.length, consumed: true }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Index of the subcommand token in `rest`, skipping global flags and
 * values of flags that accept values (e.g. `git -C dir status` → `status`).
 */
function subcommandIndex(program: string, rest: string[]): number {
  const valueFlags = VALUE_FLAGS_BEFORE_SUBCOMMAND.get(program)
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!
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
  const tokens = tokenize(text)
  const names: string[] = []
  let program: string | null = null
  let i = 0

  while (i < tokens.length) {
    const token = tokens[i]!
    i++
    if (ENV_ASSIGNMENT.test(token)) continue
    names.push(token)
    if (!WRAPPER_PROGRAMS.has(token)) {
      program = token
      break
    }
    // Skip the wrapper's own flags / numeric args (e.g. `timeout 5`).
    while (
      i < tokens.length &&
      (tokens[i]!.startsWith('-') ||
        /^\d/.test(tokens[i]!) ||
        ENV_ASSIGNMENT.test(tokens[i]!))
    )
      i++
  }

  const rest = tokens.slice(i)
  if (program && SUBCOMMAND_PROGRAMS.has(program)) {
    const subIndex = subcommandIndex(program, rest)
    const sub = subIndex === -1 ? undefined : rest[subIndex]
    if (sub) {
      names.push(sub)
      const nested = NESTED_SUBCOMMAND_PROGRAMS.get(program)
      if (nested?.has(sub)) {
        const nestedSub = rest
          .slice(subIndex + 1)
          .find((t) => !t.startsWith('-') && !ENV_ASSIGNMENT.test(t))
        if (nestedSub) names.push(nestedSub)
      }
    }
  }

  const helpOnly =
    program !== null &&
    rest.length > 0 &&
    rest.every((t) => VERSION_OR_HELP.test(t))

  return {
    pattern: names.join(' '),
    helpOnly,
    readOnlyArgs: program === null || hasReadOnlyArguments(program, rest),
  }
}

/** Split a segment into words, unquoting as the shell would. */
function tokenize(text: string): string[] {
  const tokens: string[] = []
  let current: string | null = null
  const append = (chunk: string) => (current = (current ?? '') + chunk)

  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (ch === "'") {
      const end = text.indexOf("'", i + 1)
      append(text.slice(i + 1, end === -1 ? undefined : end))
      i = end === -1 ? text.length : end + 1
    } else if (ch === '"') {
      let j = i + 1
      let chunk = ''
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\' && j + 1 < text.length) {
          chunk += text[j + 1]!
          j += 2
        } else chunk += text[j++]!
      }
      append(chunk)
      i = j + 1
    } else if (ch === '\\') {
      append(text[i + 1] ?? '')
      i += 2
    } else if (/\s/.test(ch)) {
      if (current !== null) tokens.push(current)
      current = null
      i++
    } else {
      append(ch)
      i++
    }
  }
  if (current !== null) tokens.push(current)

  return tokens
}
