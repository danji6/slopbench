import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type EnvFileVariables = Record<string, string>

const managedHeader = '# Automatically added by the runner'

export async function loadEnvFile(path: string) {
  const variables = await readEnvFile(path)

  for (const [key, value] of Object.entries(variables)) {
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }

  return variables
}

export async function readEnvFile(path: string): Promise<EnvFileVariables> {
  if (!existsSync(path)) return {}

  const variables: EnvFileVariables = {}
  const contents = await readFile(path, 'utf8')
  for (const line of contents.split(/\r?\n/)) {
    const key = keyOf(line)
    if (key) variables[key] = line.slice(key.length + 1)
  }

  return variables
}

export async function updateEnvFile(
  path: string,
  updates: Record<string, string>,
  removeKeys: string[] = [],
) {
  await mkdir(dirname(path), { recursive: true })

  const contents = existsSync(path) ? await readFile(path, 'utf8') : ''
  const managed = new Set([...Object.keys(updates), ...removeKeys])
  const kept = contents.split(/\r?\n/).filter((line) => {
    const key = keyOf(line)
    return line !== managedHeader && (!key || !managed.has(key))
  })

  const block = Object.entries(updates).map(([key, value]) => `${key}=${value}`)
  const preserved = trimBlankEdges(kept)
  const nextLines = preserved.length
    ? [...preserved, '', managedHeader, ...block]
    : [managedHeader, ...block]

  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value
  }
  for (const key of removeKeys) {
    delete process.env[key]
  }

  await writeFile(path, `${nextLines.join('\n')}\n`)
}

function keyOf(line: string): string | undefined {
  if (!line || line.startsWith('#')) return undefined

  const equalsIndex = line.indexOf('=')
  return equalsIndex > 0 ? line.slice(0, equalsIndex) : undefined
}

function trimBlankEdges(lines: string[]): string[] {
  let end = lines.length
  while (end > 0 && !lines[end - 1]?.trim()) end--

  let start = 0
  while (start < end && !lines[start]?.trim()) start++

  return lines.slice(start, end)
}
