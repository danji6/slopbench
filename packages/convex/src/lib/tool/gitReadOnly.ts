/** Git global options whose next argument is a value. */
export const GIT_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
])

/** Locate a Git subcommand without mistaking global option values for it. */
export function gitSubcommandIndex(args: string[]): number {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (!arg.startsWith('-')) return i
    if (GIT_VALUE_FLAGS.has(arg)) i++
  }
  return -1
}

type QueryOptions = {
  flags: RegExp
  values?: ReadonlySet<string>
  optionalValues?: ReadonlySet<string>
  listing?: RegExp
  positionals?: boolean
}

const REF_VALUES = new Set(['--sort', '--format', '--points-at'])
const REF_FILTERS = new Set([
  '--contains',
  '--no-contains',
  '--merged',
  '--no-merged',
])
const REF_FLAGS =
  '--ignore-case|--omit-empty|--no-column|--no-color|--no-abbrev|--(?:color|column|abbrev)(?:=.*)?'

const QUERY_OPTIONS = new Map<string, QueryOptions>([
  [
    'branch',
    {
      flags: new RegExp(
        `^(?:-[arlvi]+|--list|--all|--remotes|--verbose|--show-current|${REF_FLAGS})$`,
      ),
      values: REF_VALUES,
      optionalValues: REF_FILTERS,
      listing: /^(?:-[arlvi]*[lar][arlvi]*|--list|--all|--remotes)$/,
    },
  ],
  [
    'tag',
    {
      flags: new RegExp(`^(?:-[li]+|-n\\d*|--list|${REF_FLAGS})$`),
      values: REF_VALUES,
      optionalValues: REF_FILTERS,
      listing: /^(?:-[li]*l[li]*|--list)$/,
    },
  ],
  [
    'for-each-ref',
    {
      flags:
        /^(?:--shell|--perl|--python|--tcl|--ignore-case|--omit-empty|--color(?:=.*)?)$/,
      values: new Set([...REF_VALUES, '--count']),
      optionalValues: REF_FILTERS,
      positionals: true,
    },
  ],
  [
    'ls-remote',
    {
      flags:
        /^(?:-[htq]+|--heads|--branches|--tags|--refs|--quiet|--exit-code|--symref|--get-url)$/,
      values: new Set(['--sort']),
      positionals: true,
    },
  ],
  [
    'worktree list',
    {
      flags: /^(?:-v|-z|--verbose|--porcelain)$/,
    },
  ],
  ...['stash list', 'reflog show'].map((name): [string, QueryOptions] => [
    name,
    {
      flags:
        /^(?:-\d+|--oneline|--all|--reverse|--no-decorate|--(?:color|decorate|pretty|format)(?:=.*)?)$/,
      values: new Set(['-n', '--max-count', '--skip', '--date']),
      positionals: name === 'reflog show',
    },
  ]),
])

/** Check listing options explicitly so unknown or mutating flags need approval. */
function isReadOnlyQuery(args: string[], options: QueryOptions): boolean {
  let listing = options.positionals ?? false
  let positionals = 0
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') {
      positionals += args.length - i - 1
      break
    }
    if (!arg.startsWith('-')) {
      positionals++
      continue
    }
    const equal = arg.indexOf('=')
    const flag = equal === -1 ? arg : arg.slice(0, equal)
    if (options.values?.has(flag)) {
      if (equal === -1 && args[++i] === undefined) return false
    } else if (options.optionalValues?.has(flag)) {
      if (equal === -1 && args[i + 1] && !args[i + 1]!.startsWith('-')) i++
    } else if (options.flags.test(arg)) {
      listing ||= options.listing?.test(arg) ?? false
    } else return false
  }
  return listing || positionals === 0
}

/** Gate mixed read/write Git commands while leaving other subcommands to the safe list. */
export function isReadOnlyGitInvocation(args: string[]): boolean {
  const index = gitSubcommandIndex(args)
  const command = args[index]
  const rest = args.slice(index + 1)
  if (command === 'remote') {
    const action = rest.find((arg) => !arg.startsWith('-'))
    return action === undefined || /^(show|get-url)$/.test(action)
  }
  const nested =
    command === 'stash' || command === 'worktree' || command === 'reflog'
  const key = nested ? `${command} ${rest[0]}` : (command ?? '')
  const options = QUERY_OPTIONS.get(key)
  if (nested && !options) return false
  return !options || isReadOnlyQuery(nested ? rest.slice(1) : rest, options)
}

/** Identify ref queries whose operands are patterns or refs, never file paths. */
export function hasGitRefOperands(args: string[]): boolean {
  const command = args[gitSubcommandIndex(args)]
  return (
    command !== 'ls-remote' &&
    command !== undefined &&
    (QUERY_OPTIONS.has(command) ||
      ['stash', 'worktree', 'reflog'].includes(command)) &&
    isReadOnlyGitInvocation(args)
  )
}
