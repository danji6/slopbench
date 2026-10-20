/** Parses explicit argv and environment JSON without interpreting shell expressions. */
export function parseMcpLaunch(input: {
  argsJson?: string
  envJson?: string
  secretEnvJson?: string
}) {
  const args: unknown = JSON.parse(input.argsJson || '[]')
  if (!Array.isArray(args) || !args.every((value) => typeof value === 'string'))
    throw new Error('Arguments must be a JSON array of strings')
  return {
    args: args as string[],
    env: parseEnvironment(input.envJson),
    secretEnv:
      input.secretEnvJson === undefined
        ? undefined
        : parseEnvironment(input.secretEnvJson),
  }
}

function parseEnvironment(text?: string): Record<string, string> {
  const value: unknown = JSON.parse(text || '{}')
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== 'object' ||
    !Object.values(value).every((entry) => typeof entry === 'string')
  ) {
    throw new Error('Environment must be a JSON object of strings')
  }
  return value as Record<string, string>
}
