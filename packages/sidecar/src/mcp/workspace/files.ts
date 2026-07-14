import type {
  WorkspaceFileLink,
  WorkspaceFileListing,
} from '@sb/core/types/workspace'
import {
  MAX_TEXT_SNAPSHOT_CHARS,
  detectWorkspaceMediaType,
  isKnownTextMediaType,
} from '@sb/core/workspace/files'
import { spawn } from 'node:child_process'
import { readFile, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { glob } from 'tinyglobby'
import { z } from 'zod'

import { expandHome } from './paths'
import { requireWorkspace, resolveExistingPath } from './workspace'

const MAX_INDEX_FILES = 10_000
const MAX_LINK_BINARY_BYTES = 5_000_000
const MAX_DIR_ENTRIES = 1_000
const GLOB_IGNORES = ['**/.git/**', '**/node_modules/**']

export const listWorkspaceFilesSchema = z.object({
  sessionId: z.string(),
  workspaceId: z.string(),
})

export const listWorkspaceFilesByRootSchema = z.object({
  root: z.string().min(1),
})

export const readWorkspaceFileLinkSchema = z.object({
  sessionId: z.string(),
  workspaceId: z.string(),
  path: z.string().min(1),
})

/**
 * List workspace files. Prefers `git ls-files` and falls back to globbing
 * for non-git directories.
 */
export async function listWorkspaceFiles(
  input: z.infer<typeof listWorkspaceFilesSchema>,
): Promise<WorkspaceFileListing> {
  const workspace = await requireWorkspace(input.sessionId, input.workspaceId)
  return indexFiles(workspace.root)
}

/**
 * Like {@link listWorkspaceFiles} but not bound to a session.
 */
export async function listWorkspaceFilesByRoot(
  input: z.infer<typeof listWorkspaceFilesByRootSchema>,
): Promise<WorkspaceFileListing> {
  const root = await realpath(path.resolve(expandHome(input.root)))
  return indexFiles(root)
}

async function indexFiles(root: string): Promise<WorkspaceFileListing> {
  const all = (await gitListFiles(root)) ?? (await globListFiles(root))
  const truncated = all.length > MAX_INDEX_FILES
  const files = (truncated ? all.slice(0, MAX_INDEX_FILES) : all).sort((a, b) =>
    a.localeCompare(b),
  )
  return { files, truncated }
}

/**
 * Read a linked file or directory for context injection. Directories are
 * listed, text is inlined, and binary/large files are base64-encoded.
 */
export async function readWorkspaceFileLink(
  input: z.infer<typeof readWorkspaceFileLinkSchema>,
): Promise<WorkspaceFileLink> {
  const workspace = await requireWorkspace(input.sessionId, input.workspaceId)
  const target = await resolveExistingPath(workspace.root, input.path)

  if (target.isDirectory) return listDirectoryLink(target)
  if (!target.isFile) throw new Error('Path is not a file')

  const buffer = await readFile(target.absolutePath)
  const mediaType = detectWorkspaceMediaType(target.relativePath)

  if (isTextContent(mediaType, buffer)) {
    const raw = buffer.toString('utf-8')
    const truncated = raw.length > MAX_TEXT_SNAPSHOT_CHARS
    const content = truncated
      ? `${raw.slice(0, MAX_TEXT_SNAPSHOT_CHARS)}\n[truncated]`
      : raw
    return { kind: 'text', path: target.relativePath, content, truncated }
  }

  if (buffer.byteLength > MAX_LINK_BINARY_BYTES) {
    throw new Error('Linked file is too large')
  }

  return {
    kind: 'binary',
    path: target.relativePath,
    base64: buffer.toString('base64'),
    mediaType,
    filename: path.basename(target.relativePath),
  }
}

/** Build an `ls`-style listing, marking subdirectories with a trailing slash. */
async function listDirectoryLink(target: {
  absolutePath: string
  relativePath: string
}): Promise<WorkspaceFileLink> {
  const dirents = await readdir(target.absolutePath, { withFileTypes: true })
  const names = dirents
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    .sort((a, b) => a.localeCompare(b))
  const truncated = names.length > MAX_DIR_ENTRIES

  return {
    kind: 'directory',
    path: target.relativePath,
    entries: truncated ? names.slice(0, MAX_DIR_ENTRIES) : names,
    truncated,
  }
}

function gitListFiles(root: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    const child = spawn(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 },
    )

    let stdout = ''
    let failed = false
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.on('error', () => {
      failed = true
      resolve(null)
    })
    child.on('close', (code) => {
      if (failed) return
      if (code !== 0) return resolve(null)
      resolve(stdout.split('\0').filter(Boolean))
    })
  })
}

async function globListFiles(root: string): Promise<string[]> {
  try {
    const matches = await glob('**/*', {
      cwd: root,
      dot: true,
      onlyFiles: true,
      ignore: GLOB_IGNORES,
    })
    return matches.map((match) => match.split(path.sep).join('/'))
  } catch {
    return []
  }
}

function isTextContent(mediaType: string, buffer: Buffer): boolean {
  if (isKnownTextMediaType(mediaType)) return true
  // Treat as text only if there's no NUL byte in a sample
  if (mediaType === 'application/octet-stream') {
    return !buffer.subarray(0, 4096).includes(0)
  }
  return false
}
