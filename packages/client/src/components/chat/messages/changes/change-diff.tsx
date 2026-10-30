import { Code } from '@/components/ui'
import { useChangeDiff } from '@/hooks/chat/changes'
import { languageFromPath } from '@/lib/chat/tool-output'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { ChangedFile } from '@sb/core/types/changes'

export function ChangeDiff({
  changeSetId,
  file,
  active,
}: {
  changeSetId: Id<'changeSets'>
  file: ChangedFile
  active: boolean
}) {
  const { text, error } = useChangeDiff(changeSetId, file.key, active)

  if (!active) {
    return null
  }
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
      innerClassName="max-h-[min(384px,50dvh)] w-full overflow-auto rounded-none border-0 p-3 text-xs"
    />
  )
}
