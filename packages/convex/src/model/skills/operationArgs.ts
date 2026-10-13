import { error } from '../../errors'
import type { FileOperationArgs } from './operations'

const allowedFields: Record<FileOperationArgs['kind'], readonly string[]> = {
  ensure: ['agentId'],
  detach: ['agentId', 'removeFolder'],
  'delete-home': [],
  install: ['source', 'storageId'],
  assign: ['agentId', 'skillId'],
  'delete-assigned': ['agentId', 'assignmentId'],
  'delete-library': ['skillId'],
  home: ['agentId', 'destination', 'copyFiles'],
  duplicate: ['agentId', 'duplicateId'],
}

/** Rejects ignored fields so one operation cannot inherit another operation's authority. */
export function validateOperationArgs(args: FileOperationArgs) {
  const allowed = new Set(['kind', ...allowedFields[args.kind]])
  if (
    Object.entries(args).some(
      ([key, value]) => value !== undefined && !allowed.has(key),
    )
  ) {
    error('Unexpected arguments for this filesystem operation', 400)
  }
  if (args.kind === 'home' && args.copyFiles === undefined) {
    error('Choose whether to carry over files or start fresh', 400)
  }
}
