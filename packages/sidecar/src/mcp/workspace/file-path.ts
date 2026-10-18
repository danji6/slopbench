import {
  parseScopedPath,
  scopedDisplayPath,
} from '@sb/core/workspace/scoped-path'

import { resolveToolPath } from './access'
import { assertInside } from './paths'

/** Resolves a file prefix and enforces its boundary after symlink resolution. */
export async function resolveFileToolPath(
  root: string,
  input: string,
  allowedPaths?: string[],
  roots?: string[],
  grantRoot?: string,
) {
  const parsed = parseScopedPath(input)
  const target = await resolveToolPath(
    root,
    parsed.path,
    allowedPaths,
    roots,
    grantRoot,
  )
  if (parsed.explicit) assertInside(root, target.absolutePath)
  return {
    ...target,
    relativePath: scopedDisplayPath(input, target.relativePath),
  }
}
