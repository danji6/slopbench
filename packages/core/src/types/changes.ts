/** A persisted, immutable file delta belonging to one agent turn. */
export type ChangedFile = {
  key: string
  path: string
  kind: 'added' | 'modified' | 'deleted'
  additions: number
  deletions: number
  binary: boolean
  truncated: boolean
}

export type ChangeSummary = {
  id: string
  revision: number
  state: 'applied' | 'reverted'
  files: ChangedFile[]
  additions: number
  deletions: number
  issues: string[]
}

export type ChangePublication = ChangeSummary & {
  diffs: Record<string, string>
}

export type RestoreChangesResult = {
  summary: ChangeSummary
  conflicts: string[]
}
