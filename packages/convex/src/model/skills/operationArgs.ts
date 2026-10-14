import { validate } from 'convex-helpers/validators'

import { error } from '../../errors'
import type { FileOperationArgs } from '../../types'
import { fileOperationArgsValidator } from '../../validators/fileOperations'

/** Validates internal callers with the same command contract as the public mutation. */
export function validateOperationArgs(args: FileOperationArgs) {
  if (!validate(fileOperationArgsValidator, args)) {
    error('Invalid arguments for this filesystem operation', 400)
  }
  if (args.kind === 'home' && !args.destination.trim()) {
    error('Choose a destination directory', 400)
  }
  if (args.kind === 'install' && 'source' in args && !args.source.trim()) {
    error('Choose a local directory or an uploaded ZIP', 400)
  }
}
