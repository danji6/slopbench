/**
 * Argument-aware read-only gates for programs that are safe by default but
 * have mutating or command-executing arguments. A gated program only counts
 * as built-in safe when its arguments pass the gate, otherwise it needs
 * approval like any unlisted program.
 */

type ArgumentGate = (args: string[]) => boolean

/** find actions that delete, execute commands, or write files. */
const FIND_MUTATING_ARGS =
  /^(-delete|-exec(dir)?|-ok(dir)?|-fprint0?|-fprintf|-fls)$/

/** `git remote` actions that only read (no local ref/config mutation). */
const GIT_REMOTE_READ_ONLY = /^(show|get-url)$/

/**
 * git global flags that consume the following token as their value (e.g.
 * `git -C /path`). They must be skipped along with their value when locating
 * the subcommand, or the value is mistaken for the subcommand.
 */
export const GIT_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
])

/** GNU sed long options that keep an invocation read-only. */
const SAFE_SED_LONG_FLAGS = new Set([
  '--quiet',
  '--silent',
  '--regexp-extended',
  '--separate',
  '--unbuffered',
  '--null-data',
  '--posix',
  '--sandbox',
  '--debug',
  '--help',
  '--version',
])

/** GNU sed short options that keep an invocation read-only. */
const SAFE_SED_SHORT_FLAGS = new Set([...'nrEszu'])

const GATES = new Map<string, ArgumentGate>([
  ['find', (args) => !args.some((arg) => FIND_MUTATING_ARGS.test(arg))],
  ['sed', isReadOnlySedInvocation],
  ['git', isReadOnlyGitInvocation],
])

/** Whether `program args` stays read-only. True for ungated programs. */
export function hasReadOnlyArguments(program: string, args: string[]): boolean {
  const gate = GATES.get(program)
  return gate ? gate(args) : true
}

/**
 * git is gated by subcommand in the safe-list. Only `git remote` needs
 * argument inspection, since `git remote`/`-v`/`show`/`get-url` read while
 * `add`, `rename`, `set-url`, `prune`, ... mutate. Any other subcommand passes
 * through (its read-only-ness is decided by the safe list pattern).
 */
function isReadOnlyGitInvocation(args: string[]): boolean {
  const positionals: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg.startsWith('-')) {
      if (GIT_VALUE_FLAGS.has(arg)) i++ // Skip the flag's value token
      continue
    }
    positionals.push(arg)
  }
  if (positionals[0] !== 'remote') return true
  return positionals.length < 2 || GIT_REMOTE_READ_ONLY.test(positionals[1]!)
}

/**
 * A sed invocation is read-only when it has no in-place/script-file flags and
 * every script (positional or via -e/--expression) only filters to stdout.
 * Unknown flags fail closed.
 */
function isReadOnlySedInvocation(args: string[]): boolean {
  const scripts: string[] = []
  let positionalScriptSeen = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') break // only input files follow
    if (arg.startsWith('--')) {
      if (arg.startsWith('--expression=')) {
        scripts.push(arg.slice('--expression='.length))
      } else if (
        !SAFE_SED_LONG_FLAGS.has(arg) &&
        !arg.startsWith('--line-length')
      ) {
        return false
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      const script = consumeSedShortFlags(arg, () => args[++i])
      if (script === false) return false
      if (typeof script === 'string') scripts.push(script)
    } else if (!positionalScriptSeen) {
      positionalScriptSeen = true
      if (scripts.length === 0) scripts.push(arg)
      // With -e present, the first positional is already an input file
    }
  }

  return scripts.every(isReadOnlySedScript)
}

/**
 * Walks a short option cluster like `-ne`. Returns the script argument when
 * the cluster ends in `-e`, false when it contains a non-read-only flag.
 */
function consumeSedShortFlags(
  cluster: string,
  nextArg: () => string | undefined,
): string | undefined | false {
  for (let i = 1; i < cluster.length; i++) {
    const flag = cluster[i]!
    if (SAFE_SED_SHORT_FLAGS.has(flag)) continue
    if (flag === 'e') {
      return cluster.length > i + 1 ? cluster.slice(i + 1) : nextArg()
    }
    return false // -i, -f, and anything unrecognized
  }
  return undefined
}

/** Commands that only affect the output stream (no s/y, handled separately). */
const SAFE_SED_COMMANDS = new Set([...'pPdD=lnNhHgGxFz'])

/**
 * True when a sed script only reads input and prints to stdout. Rejects
 * command execution (`e`, `s///e`), file writes (`w`, `W`, `s///w`), file
 * reads that bypass path checks (`r`, `R`), and anything unrecognized.
 */
export function isReadOnlySedScript(script: string): boolean {
  let i = 0

  // Advances past the next unescaped `delim`; false if it never appears
  const skipPast = (delim: string): boolean => {
    while (i < script.length) {
      if (script[i] === '\\') {
        i += 2
      } else if (script[i] === delim) {
        i++
        return true
      } else i++
    }
    return false
  }

  while (i < script.length) {
    const ch = script[i]!
    if (/[\s0-9,~$;{}!]/.test(ch))
      i++ // addresses and separators
    else if (ch === '/') {
      i++
      if (!skipPast('/')) return false // /regex/ address
    } else if (ch === 's' || ch === 'y') {
      const delim = script[i + 1]
      if (!delim) return false
      i += 2
      if (!skipPast(delim) || !skipPast(delim)) return false
      // e (execute) and w (write) are not read-only substitution flags
      while (i < script.length && /[0-9gpiImM]/.test(script[i]!)) i++
    } else if (ch === 'a' || ch === 'i' || ch === 'c') {
      i++ // appended/inserted text runs to the end of the line
      if (script[i] === '\\') i++
      if (!skipPast('\n')) i = script.length
    } else if (ch === 'b' || ch === 't' || ch === 'T' || ch === ':') {
      i++ // branches and labels
      while (i < script.length && !/[;\s}]/.test(script[i]!)) i++
    } else if (ch === 'q' || ch === 'Q') {
      i++ // optional exit code
      while (i < script.length && /[\d\s]/.test(script[i]!)) i++
    } else if (SAFE_SED_COMMANDS.has(ch)) i++
    else return false // e, w, W, r, R, unknown
  }

  return true
}
