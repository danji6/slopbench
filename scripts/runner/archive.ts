import { output } from './processes'

/** Unpacks a downloaded archive, picking the tool from its extension. */
export async function extractArchive(
  archivePath: string,
  destination: string,
  cwd: string,
) {
  if (archivePath.endsWith('.zip')) {
    await extractZip(archivePath, destination, cwd)
    return
  }
  await extractTar(archivePath, destination, cwd)
}

export async function extractZip(
  zipPath: string,
  destination: string,
  cwd: string,
) {
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

export async function extractTar(
  archivePath: string,
  destination: string,
  cwd: string,
) {
  await output(['tar', '-xf', archivePath, '-C', destination], { cwd })
}
