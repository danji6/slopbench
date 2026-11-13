import { Code, Popover } from '@/components/ui'
import { useChangeDiff } from '@/hooks/chat/changes'
import { languageFromPath } from '@/lib/chat/tool-output'
import type { Id } from '@cv/convex/_generated/dataModel'
import type { ChangedFile } from '@cv/core/types/changes'

import { usePendingMessageLayout } from '../message-list/message-list-context'

type ChangeDiffProps = {
  changeSetId: Id<'changeSets'>
  file: ChangedFile
  active: boolean
}

type ChangeDiffContentProps = {
  file: ChangedFile
  text?: string
  error?: string
}

export function ChangeDiff({ changeSetId, file, active }: ChangeDiffProps) {
  const result = useChangeDiff(changeSetId, file.key, active)
  usePendingMessageLayout(active && result.text === undefined && !result.error)

  if (!active) {
    return null
  }

  return <ChangeDiffContent file={file} {...result} />
}

/** Positions the hover preview using the loaded diff's dimensions. */
export function ChangeDiffPreview({
  changeSetId,
  file,
  active,
}: ChangeDiffProps) {
  const result = useChangeDiff(changeSetId, file.key, active)
  if (result.text === undefined && !result.error) return null

  return (
    <Popover.Content
      side="top"
      align="start"
      className="ring-input bg-m3-surface-container w-[min(720px,calc(100dvw-2rem))] gap-0 overflow-hidden p-2"
    >
      <div className="px-1 pt-1 pb-2 font-mono text-xs break-all">
        {file.path}
      </div>
      <div className="border-border overflow-hidden rounded-[calc(var(--radius-lg)-var(--spacing)*2)] border">
        <ChangeDiffContent file={file} {...result} />
      </div>
    </Popover.Content>
  )
}

function ChangeDiffContent({ file, text, error }: ChangeDiffContentProps) {
  if (error) {
    return (
      <p role="alert" className="text-destructive p-3 text-sm">
        {error}
      </p>
    )
  }
  if (text === undefined)
    return (
      <p role="status" className="text-muted-foreground p-3 text-sm">
        Loading diff…
      </p>
    )
  if (file.binary || !text.startsWith('--- ')) {
    return <p className="text-muted-foreground p-3 text-sm">{text}</p>
  }

  return (
    <Code
      text={text}
      language={languageFromPath(file.path)}
      diff
      hugParent
      noCopyButton
      noLoadingIndicator
      className="rounded-none"
      innerClassName="max-h-[min(384px,50dvh)] w-full overflow-auto rounded-none border-0 text-xs"
    />
  )
}
