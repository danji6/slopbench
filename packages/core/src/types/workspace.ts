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
  | WorkspaceTextLink
  | WorkspaceBinaryLink
  | WorkspaceDirectoryLink

export type WorkspaceFileListing = { files: string[]; truncated: boolean }
