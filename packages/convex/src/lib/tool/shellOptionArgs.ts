export interface ShellOptionSpec {
  switches: ReadonlySet<string>
  required: ReadonlySet<string>
  optional?: ReadonlySet<string>
  legacyCount?: boolean
}

export interface ShellOption {
  flag: string
  value?: string
}

export interface ShellOptionArgs {
  operands: string[]
  options: ShellOption[]
  complete: boolean
}

/** Classify options without confusing their values with filesystem operands. */
export function parseShellOptionArgs(
  args: string[],
  spec: ShellOptionSpec,
): ShellOptionArgs {
  const result: ShellOptionArgs = { operands: [], options: [], complete: true }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') {
      result.operands.push(...args.slice(i + 1))
      break
    }
    if (arg === '-' || !arg.startsWith('-')) result.operands.push(arg)
    else if (spec.legacyCount && /^-\d+$/.test(arg)) continue
    else {
      const options = splitOptions(arg, spec)
      for (const option of options) {
        if (spec.required.has(option.flag) && option.value === undefined) {
          option.value = args[++i]
          if (option.value === undefined) result.complete = false
        } else if (!isKnownOption(option.flag, spec)) result.complete = false
        result.options.push(option)
      }
    }
  }
  return result
}

function isKnownOption(flag: string, spec: ShellOptionSpec): boolean {
  return (
    spec.switches.has(flag) ||
    spec.required.has(flag) ||
    !!spec.optional?.has(flag)
  )
}

/** A value-taking short option consumes the rest of its cluster. */
function splitOptions(arg: string, spec: ShellOptionSpec): ShellOption[] {
  if (arg.startsWith('--')) {
    const equal = arg.indexOf('=')
    if (equal === -1) return [{ flag: arg }]
    const flag = arg.slice(0, equal)
    if (!spec.required.has(flag) && !spec.optional?.has(flag)) {
      return [{ flag: arg }]
    }
    return [{ flag, value: arg.slice(equal + 1) }]
  }
  const options: ShellOption[] = []
  for (let i = 1; i < arg.length; i++) {
    const flag = `-${arg[i]}`
    if (spec.required.has(flag)) {
      options.push({ flag, value: arg.slice(i + 1) || undefined })
      break
    }
    options.push({ flag })
  }
  return options
}
