export type WorkspaceTextLink = {
  kind: 'text'
  path: string
  content: string
  truncated: boolean
}

export type WorkspaceBinaryLink = {
  kind: 'binary'
  path: string
  base64: string
  mediaType: string
  filename: string
}

export type WorkspaceDirectoryLink = {
  kind: 'directory'
  path: string
  entries: string[]
  truncated: boolean
}

export type WorkspaceFileLink =
  WorkspaceTextLink | WorkspaceBinaryLink | WorkspaceDirectoryLink

/** A binary link cached at send time. */
export type WorkspaceBinaryRefLink<TStorageId extends string = string> = {
  kind: 'binary-ref'
  path: string
  storageId: TStorageId
  mediaType: string
  filename: string
}

/** A link deliberately not injected (e.g. over the binary size cap). */
export type WorkspaceSkippedLink = {
  kind: 'skipped'
  path: string
  reason: string
}

/**
 * What a persisted `file-link` part may carry.
 * `TStorageId` lets Convex callers keep their `Id<'_storage'>`.
 */
export type WorkspaceLinkSnapshot<TStorageId extends string = string> =
  | WorkspaceTextLink
  | WorkspaceDirectoryLink
  | WorkspaceBinaryRefLink<TStorageId>
  | WorkspaceSkippedLink

export type WorkspaceFileListing = { files: string[]; truncated: boolean }
