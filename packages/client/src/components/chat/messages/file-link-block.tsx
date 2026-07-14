import { FileIcon, FolderIcon } from 'lucide-react'

export type FileLinkBlockProps = {
  path: string
}

export function FileLinkBlock({ path }: FileLinkBlockProps) {
  const isDir = path.endsWith('/')

  return (
    <span
      data-slot="file-link-block"
      className="bg-m3-surface-container text-muted-foreground mb-1 inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 align-middle font-mono text-xs"
      title={path}
    >
      {isDir ? (
        <FolderIcon className="size-3.5 shrink-0" />
      ) : (
        <FileIcon className="size-3.5 shrink-0" />
      )}
      <span className="truncate">{path}</span>
    </span>
  )
}
