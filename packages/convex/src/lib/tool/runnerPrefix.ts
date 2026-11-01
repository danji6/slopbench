import type { RunnerOptionSpec } from './runnerOptions'
import { parseShellOptionArgs } from './shellOptionArgs'
import type { ShellToken } from './shellParse'

export type RunnerPrefix = {
  args: ShellToken[]
  values: string[]
  complete: boolean
  terminated?: boolean
}

/** Parse only runner options, leaving the launched command's tokens intact. */
export function parseRunnerPrefix(
  args: ShellToken[],
  spec: RunnerOptionSpec,
): RunnerPrefix {
  const parsed = parseShellOptionArgs(
    args.map((token) => token.value),
    spec,
  )
  const values: string[] = []
  let complete = parsed.complete
  for (const option of parsed.options) {
    if (spec.blocked.has(option.flag)) complete = false
    if (!option.value) continue
    if (spec.paths.has(option.flag)) values.push(option.value)
    if (spec.packages.has(option.flag)) {
      const source = packageSource(option.value)
      values.push(...source.values)
      complete &&= source.complete
    }
  }
  return {
    args: args.slice(args.length - parsed.operands.length),
    values,
    complete,
    terminated: parsed.terminated,
  }
}

/** Keep local package sources while leaving registry names and versions as data. */
function packageSource(value: string) {
  if (/^(?:file:|link:|workspace:)|\s@\s/.test(value)) {
    return { values: [], complete: false }
  }
  const local = /^(?:[./~]|[a-z]:[\\/])/.test(value)
  return { values: local ? [value] : [], complete: true }
}
