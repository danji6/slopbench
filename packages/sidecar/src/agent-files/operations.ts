import type { AgentHome } from '@sb/core/skills/types'
import { createWriteStream } from 'node:fs'
import {
  mkdir,
  opendir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { expandHome } from '../mcp/workspace/paths'
import { withAgentMutation } from './access'
import { inspectHome } from './home-state'
import { discoverImport } from './import-discovery'
import { publishTree } from './merge'
import { readSkillMetadata } from './metadata'
import { publishDirectory, recoverDirectoryPublish } from './publish'
import {
  assertPlainPath,
  copyTree,
  inside,
  isMissing,
  libraryRoot,
  managedHome,
  operationRoot,
  resolveHome,
} from './storage'
import { stripUploadHeader } from './upload'
import { extractSkillZip } from './zip'

export type FileOperation = {
  id: string
  ownerId: string
  agentId?: string
  homeId?: string
  destinationHomeId?: string
  destinationOriginAgentId?: string
  originAgentId?: string
  homePath?: string
  destination?: string
  skillId?: string
  name?: string
  source?: string
  ticket?: string
  fileUrl?: string
  homeOperationId?: string
  copyFiles?: boolean
  sourceHome?: { path?: string; originAgentId: string }
  kind:
    | 'install'
    | 'delete-home'
    | 'discover-import'
    | 'assign'
    | 'delete-assigned'
    | 'delete-library'
    | 'prepare-home'
    | 'stage-home-skill'
    | 'publish-home'
    | 'duplicate'
}

const running = new Map<string, Promise<unknown>>()

/** Replays completed filesystem work instead of executing destructive retries twice. */
export async function runFileOperation(input: FileOperation): Promise<unknown> {
  const cached = running.get(input.id)
  if (cached) return cached

  const operation = withAgentMutation(input.homeId ?? input.agentId, () =>
    withAgentMutation(
      input.destinationHomeId ??
        (input.kind === 'duplicate' ? input.destination : undefined),
      () => executeOnce(input),
    ),
  )
  running.set(input.id, operation)
  try {
    return await operation
  } finally {
    running.delete(input.id)
  }
}

async function executeOnce(input: FileOperation) {
  const root = operationRoot(input.id)
  await assertPlainPath(root)
  await mkdir(root, { recursive: true })

  try {
    return JSON.parse(
      await readFile(path.join(root, 'done.json'), 'utf8'),
    ) as unknown
  } catch (error) {
    if (!isMissing(error)) throw error
  }

  const recovered = await recoverDirectoryPublish(root)
  const result = recovered ? recovered.result : await execute(input)
  const temporary = path.join(root, 'done.tmp')
  await writeFile(temporary, JSON.stringify(result))
  await rename(temporary, path.join(root, 'done.json'))

  return result
}

async function execute(input: FileOperation) {
  switch (input.kind) {
    case 'delete-home':
      return removeManagedHome(input)
    case 'discover-import':
      return discoverImport(input)
    case 'install':
      return installSkill(input)
    case 'assign':
      return assignSkill(input)
    case 'stage-home-skill':
      return assignSkill(
        input,
        path.join(operationRoot(input.homeOperationId!), 'home'),
      )
    case 'prepare-home':
      return prepareHome(input)
    case 'publish-home':
      return publishHome(input)
    case 'duplicate':
      return duplicateHome(input)
    case 'delete-assigned': {
      const home = await resolveHome(
        input.ownerId,
        input.originAgentId ?? input.agentId!,
        input.homePath,
      )
      const target = skillCopy(home, input.name!)
      await assertPlainPath(target)
      await rm(target, { recursive: true, force: true })
      return { ok: true }
    }
    case 'delete-library': {
      const root = libraryRoot(input.ownerId, input.skillId!)
      await assertPlainPath(root)
      await rm(root, { recursive: true, force: true })
      return { ok: true }
    }
  }
}

export function skillCopy(home: string, name: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
    throw new Error('Invalid skill directory name')
  return path.join(home, 'skills', name)
}

async function installSkill(input: FileOperation) {
  const root = operationRoot(input.id)
  const staging = path.join(root, 'bundle')

  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })

  if (input.fileUrl) {
    const archive = path.join(root, 'upload.zip')

    const response = await fetch(input.fileUrl, { redirect: 'error' })
    if (!response.ok || !response.body)
      throw new Error('Could not download the uploaded skill')

    const download = Readable.fromWeb(
      response.body as unknown as Parameters<typeof Readable.fromWeb>[0],
    )

    if (input.ticket) {
      await pipeline(
        download,
        stripUploadHeader(input.ticket),
        createWriteStream(archive),
      )
    } else {
      await pipeline(download, createWriteStream(archive))
    }
    await extractSkillZip(archive, staging)
  } else {
    if (!input.source) throw new Error('Choose a skill directory')
    const source = await realpath(path.resolve(expandHome(input.source)))
    await readSkillMetadata(source)
    await copyTree(source, staging)
  }

  const bundle = await findBundle(staging)
  const metadata = await readSkillMetadata(bundle)
  const destination = libraryRoot(input.ownerId, input.skillId!)
  await assertPlainPath(destination)
  await mkdir(path.dirname(destination), { recursive: true })
  const container = path.join(root, 'installed')
  await rm(container, { recursive: true, force: true })
  await mkdir(container)
  await rename(bundle, path.join(container, metadata.name))
  await publishDirectory(container, destination, root, metadata)
  await rm(path.join(root, 'upload.zip'), { force: true })

  return metadata
}

async function findBundle(root: string) {
  try {
    await stat(path.join(root, 'SKILL.md'))
    return root
  } catch (error) {
    if (!isMissing(error)) throw error
  }

  let child: string | undefined
  for await (const entry of await opendir(root)) {
    if (child || !entry.isDirectory()) {
      throw new Error(
        'ZIP must contain a single skill directory or a root SKILL.md',
      )
    }
    child = path.join(root, entry.name)
  }
  if (!child) throw new Error('Skill bundle is empty')

  return child
}

async function assignSkill(input: FileOperation, stagingHome?: string) {
  const home =
    stagingHome ??
    (await resolveHome(
      input.ownerId,
      input.originAgentId ?? input.agentId!,
      input.homePath,
    ))

  const target = skillCopy(home, input.name!)
  await assertPlainPath(target)
  const staging = path.join(operationRoot(input.id), 'copy')

  await rm(staging, { recursive: true, force: true })
  const source = input.sourceHome
    ? skillCopy(
        await resolveHome(
          input.ownerId,
          input.sourceHome.originAgentId,
          input.sourceHome.path,
        ),
        input.name!,
      )
    : path.join(libraryRoot(input.ownerId, input.skillId!), input.name!)
  try {
    await copyTree(source, staging)
  } catch (cause) {
    if (input.sourceHome && isMissing(cause))
      throw new Error(
        `Agent copy of ${input.name} is missing; it cannot be restored from the deleted library bundle`,
        { cause },
      )
    throw cause
  }
  await mkdir(path.dirname(target), { recursive: true })

  try {
    await stat(target)
    throw new Error(
      'A skill directory already exists, delete its assignment before adding it again',
    )
  } catch (error) {
    if (!isMissing(error)) throw error
  }

  await publishDirectory(staging, target, operationRoot(input.id), { ok: true })

  return { ok: true }
}

async function prepareHome(input: FileOperation) {
  const source = await inspectHome({
    ownerId: input.ownerId,
    agentId: input.agentId!,
    originAgentId: input.originAgentId,
    path: input.homePath,
    revision: 0,
  })

  const destination = await resolveHome(
    input.ownerId,
    input.destinationOriginAgentId ?? input.agentId!,
    input.destination ===
      managedHome(
        input.ownerId,
        input.destinationOriginAgentId ?? input.agentId!,
      )
      ? undefined
      : input.destination,
    true,
  )

  if (source.exists && source.path === destination)
    return { path: destination, unchanged: true, sourceMissing: false }

  if (
    source.path !== destination &&
    (inside(source.path, destination) || inside(destination, source.path))
  ) {
    throw new Error('Personal home directories cannot overlap')
  }

  const staging = path.join(operationRoot(input.id), 'home')
  await rm(staging, { recursive: true, force: true })

  if (input.copyFiles && source.exists) {
    await copyTree(source.path, staging)
  } else {
    await mkdir(staging, { recursive: true })
  }

  return { path: destination, unchanged: false, sourceMissing: !source.exists }
}

async function publishHome(input: FileOperation) {
  const prepared = JSON.parse(
    await readFile(
      path.join(operationRoot(input.homeOperationId!), 'done.json'),
      'utf8',
    ),
  ) as { path: string; unchanged: boolean }

  if (!prepared.unchanged) {
    await publishTree(
      path.join(operationRoot(input.homeOperationId!), 'home'),
      prepared.path,
      operationRoot(input.id),
    )
  }

  return { path: prepared.path }
}

async function duplicateHome(input: FileOperation) {
  const source = await resolveHome(
    input.ownerId,
    input.originAgentId ?? input.agentId!,
    input.homePath,
  )
  const target = managedHome(input.ownerId, input.destination!)
  await assertPlainPath(target)
  const staging = path.join(operationRoot(input.id), 'home')

  await rm(staging, { recursive: true, force: true })
  await copyTree(source, staging)
  await mkdir(path.dirname(target), { recursive: true })

  try {
    await stat(target)
    throw new Error('Duplicate home already exists')
  } catch (error) {
    if (!isMissing(error)) {
      throw error
    }
  }

  await publishDirectory(staging, target, operationRoot(input.id), {
    path: target,
  })

  return { path: target }
}

export async function homeInfo(
  input: Omit<AgentHome, 'path'> & { path?: string },
): Promise<AgentHome> {
  return {
    ...input,
    path: await resolveHome(
      input.ownerId,
      input.originAgentId ?? input.agentId,
      input.path,
    ),
  }
}

/** Removes only the exact managed root reserved by the authenticated backend. */
async function removeManagedHome(input: FileOperation) {
  const target = managedHome(
    input.ownerId,
    input.originAgentId ?? input.agentId!,
  )
  if (input.homePath && path.resolve(input.homePath) !== target)
    throw new Error('Cleanup target is not a managed folder')
  await assertPlainPath(target)
  try {
    if ((await realpath(target)) !== target)
      throw new Error('Managed folder changed')
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  await rm(target, { recursive: true, force: true })
  return { ok: true }
}
