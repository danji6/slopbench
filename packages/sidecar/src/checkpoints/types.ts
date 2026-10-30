import type { ChangePublication } from '@sb/core/types/changes'
import type { FolderWorkspace } from '@sb/core/types/workspace'

export type FileState = {
  hash: string
  mode: number
  size: number
}

export type Snapshot = Record<string, FileState>

export type CaptureWaiter = {
  id: string
  roots: string[]
  createdAt: number
  sessionId: string
}

export type CheckpointFile = {
  target: string
  path: string
  before?: FileState
  after?: FileState
}

export type Checkpoint = {
  version: 1
  id: string
  sessionId: string
  groupId: string
  roots: string[]
  files: CheckpointFile[]
  publication: ChangePublication
  operation?: { id: string; direction: 'revert' | 'reapply' }
}

export type Participant = {
  id: string
  sessionId: string
  workspace: FolderWorkspace
  finished: boolean
  completedCheckpoint?: string
}

export type CaptureGroup = {
  version: 1
  id: string
  sessionId: string
  roots: string[]
  participants: Participant[]
  baseline: Snapshot
  explicit: string[]
  excluded: string[]
  issues: string[]
  sealed: boolean
  released: boolean
  interrupted?: boolean
  pendingCheckpoint?: string
  shellPids?: number[]
}

export type BeginCapture = {
  root?: boolean
  groupId: string
  participantId: string
  sessionId: string
  workspace: FolderWorkspace
}

export type FinishCapture = {
  groupId: string
  participantId: string
  checkpointId: string
  root: boolean
  pendingParticipants?: string[]
}

export type RestoreInput = {
  checkpointId: string
  sessionId: string
  operationId: string
  revision: number
  direction: 'revert' | 'reapply'
  workspace: FolderWorkspace
  allowedPaths: string[]
  workspaces?: FolderWorkspace[]
}

export type RestoreJournal = {
  version: 1
  checkpointId: string
  operationId: string
  roots: string[]
  original: CheckpointFile[]
  committed: boolean
  blocked?: string
}
