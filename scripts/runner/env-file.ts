import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type EnvFileVariables = Record<string, string>

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
    if (!line || line.startsWith('#')) continue

    const equalsIndex = line.indexOf('=')
    if (equalsIndex <= 0) continue

    variables[line.slice(0, equalsIndex)] = line.slice(equalsIndex + 1)
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
  const updateKeys = new Set(Object.keys(updates))
  const deletedKeys = new Set(removeKeys)
  const nextLines = contents.split(/\r?\n/).filter((line) => {
    if (!line) return false

    const key = line.slice(0, line.indexOf('='))
    return !updateKeys.has(key) && !deletedKeys.has(key)
  })

  for (const [key, value] of Object.entries(updates)) {
    nextLines.push(`${key}=${value}`)
    process.env[key] = value
  }
  for (const key of removeKeys) {
    delete process.env[key]
  }

  await writeFile(path, `${nextLines.join('\n')}\n`)
}
