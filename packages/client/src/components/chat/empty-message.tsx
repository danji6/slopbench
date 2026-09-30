import { cn } from '@/lib'

import { FolderIconView } from './sessions/folder-picker'

export function EmptyMessage({
  folderName,
  folderIcon,
  style,
  className,
}: {
  folderName?: string
  folderIcon?: string
  style?: React.CSSProperties
  className?: string
}) {
  return (
    <div
      className={cn('text-muted-foreground mx-auto text-center', className)}
      style={style}
    >
      {folderName ? (
        <span className="flex items-center justify-center gap-2">
          <FolderIconView icon={folderIcon} />
          {folderName}
        </span>
      ) : (
        'Send a message to start a new session'
      )}
    </div>
  )
}
