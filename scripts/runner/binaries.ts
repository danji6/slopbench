import { existsSync } from 'node:fs'
import { chmod, cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { type RunnerConfig, executableName } from './config'
import { output } from './processes'

export async function ensureConvexBinaries(config: RunnerConfig) {
  await mkdir(config.binDir, { recursive: true })

  if (!(await hasPinnedNode(config))) {
    await downloadNode(config)
  }

  prependPath(dirname(config.nodeBinary))

  if (!existsSync(config.convexBinary)) {
    await downloadBinary('convex-local-backend', config.convexBinary, config)
  }
}

async function hasPinnedNode(config: RunnerConfig) {
  if (!existsSync(config.nodeBinary)) return false
  try {
    const version = await output([config.nodeBinary, '--version'], {
      cwd: config.projectRoot,
    })
    return version.replace(/^v/, '') === config.nodeVersion.replace(/^v/, '')
  } catch {
    return false
  }
}

async function downloadNode(config: RunnerConfig) {
  const version = config.nodeVersion.startsWith('v')
    ? config.nodeVersion
    : `v${config.nodeVersion}`
  const archiveName = nodeArchiveName(version)
  const url = `https://nodejs.org/dist/${version}/${archiveName}`
  const tmp = join(config.dataDir, 'tmp',`node-${Date.now()}`)
  const archivePath = join(tmp, archiveName)

  console.log(`Downloading Node.js ${version}...`)
  await mkdir(tmp, { recursive: true })

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`)
  }

  await writeFile(archivePath, new Uint8Array(await response.arrayBuffer()))
  await extractNodeArchive(archivePath, tmp, config.projectRoot)

  const node = await findExtractedBinary(tmp, 'node')
  const sourceRoot = nodeInstallDir(node)
  const destinationRoot = nodeInstallDir(config.nodeBinary)

  await rm(destinationRoot, { force: true, recursive: true })
  await mkdir(dirname(destinationRoot), { recursive: true })
  await cp(sourceRoot, destinationRoot, { recursive: true })
  if (process.platform !== 'win32') {
    await chmod(config.nodeBinary, 0o755)
  }
  await rm(tmp, { force: true, recursive: true })

  console.log(`Saved Node.js to ${config.nodeBinary}`)
}

async function downloadBinary(
  asset: 'convex-local-backend',
  destination: string,
  config: RunnerConfig,
) {
  const tag = config.releaseTag ?? (await latestReleaseTag())
  const triple = platformTriple()
  const zipName = `${asset}-${triple}.zip`
  const url = `https://github.com/get-convex/convex-backend/releases/download/${tag}/${zipName}`
  const tmp = join(config.dataDir, 'tmp',`${asset}-${Date.now()}`)
  const zipPath = join(tmp, zipName)

  console.log(`Downloading ${asset} (${tag})...`)
  await mkdir(tmp, { recursive: true })

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`)
  }

  await writeFile(zipPath, new Uint8Array(await response.arrayBuffer()))
  await extractZip(zipPath, tmp, config.projectRoot)

  const binary = await findExtractedBinary(tmp, asset)
  await cp(binary, destination)
  if (process.platform !== 'win32') {
    await chmod(destination, 0o755)
  }
  await rm(tmp, { force: true, recursive: true })

  console.log(`Saved to ${destination}`)
}

function prependPath(dir: string) {
  const delimiter = process.platform === 'win32' ? ';' : ':'
  const current = process.env.PATH ?? ''
  const entries = current.split(delimiter).filter(Boolean)
  if (!entries.includes(dir)) {
    process.env.PATH = [dir, ...entries].join(delimiter)
  }
}

function nodeInstallDir(nodeBinary: string) {
  return process.platform === 'win32'
    ? dirname(nodeBinary)
    : dirname(dirname(nodeBinary))
}

async function latestReleaseTag() {
  const response = await fetch(
    'https://api.github.com/repos/get-convex/convex-backend/releases/latest',
  )
  if (!response.ok) {
    throw new Error(`Failed to fetch latest Convex release: ${response.status}`)
  }

  const body = (await response.json()) as { tag_name?: string }
  if (!body.tag_name) {
    throw new Error('Latest Convex release response did not include tag_name')
  }
  return body.tag_name
}

async function extractZip(zipPath: string, destination: string, cwd: string) {
  if (process.platform === 'win32') {
    await output(
      [
        'powershell',
        '-NoProfile',
        '-Command',
        `Expand-Archive -Force -LiteralPath '${zipPath}' -DestinationPath '${destination}'`,
      ],
      { cwd },
    )
    return
  }

  await output(['unzip', '-q', zipPath, '-d', destination], { cwd })
}

async function extractNodeArchive(
  archivePath: string,
  destination: string,
  cwd: string,
) {
  if (process.platform === 'win32') {
    await extractZip(archivePath, destination, cwd)
    return
  }

  await output(['tar', '-xJf', archivePath, '-C', destination], { cwd })
}

async function findExtractedBinary(
  dir: string,
  asset: string,
): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true })
  const expected = new Set([asset, executableName(asset)])

  for (const entry of entries) {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) {
      try {
        return await findExtractedBinary(path, asset)
      } catch {
        continue
      }
    }
    if (entry.isFile() && expected.has(entry.name)) {
      return path
    }
  }

  throw new Error(`Could not find ${asset} in downloaded archive`)
}

function platformTriple() {
  const arch = archName()

  switch (process.platform) {
    case 'darwin':
      return `${arch}-apple-darwin`
    case 'linux':
      return `${arch}-unknown-linux-gnu`
    case 'win32':
      return `${arch}-pc-windows-msvc`
    default:
      throw new Error(`Unsupported OS: ${process.platform}`)
  }
}

function nodeArchiveName(version: string) {
  const arch = nodeArchName()

  switch (process.platform) {
    case 'darwin':
      return `node-${version}-darwin-${arch}.tar.xz`
    case 'linux':
      return `node-${version}-linux-${arch}.tar.xz`
    case 'win32':
      return `node-${version}-win-${arch}.zip`
    default:
      throw new Error(`Unsupported OS: ${process.platform}`)
  }
}

function archName() {
  switch (process.arch) {
    case 'arm64':
      return 'aarch64'
    case 'x64':
      return 'x86_64'
    default:
      throw new Error(`Unsupported arch: ${process.arch}`)
  }
}

function nodeArchName() {
  switch (process.arch) {
    case 'arm64':
      return process.platform === 'win32' ? 'arm64' : 'arm64'
    case 'x64':
      return 'x64'
    default:
      throw new Error(`Unsupported arch: ${process.arch}`)
  }
}
