import { errorMessage } from '@sb/core/utils/errors'

/** Describes a folder browsing failure with a useful next step. */
export function directoryBrowseError(error: unknown): string {
  const message = errorMessage(error) ?? ''
  if (/\bENOENT\b|directory not found/i.test(message)) {
    return 'Directory not found'
  }
  if (/\b(EACCES|EPERM)\b|permission denied/i.test(message)) {
    return 'You don’t have access to this directory'
  }
  if (/\bENOTDIR\b/i.test(message)) {
    return 'This path isn’t a directory'
  }
  return 'Couldn’t open this folder'
}
