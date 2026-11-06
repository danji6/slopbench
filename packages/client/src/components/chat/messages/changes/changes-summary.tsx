import {
  Accordion,
  Button,
  Popover,
  RippleButton,
  Skeleton,
} from '@/components/ui'
import { useTurnChanges } from '@/hooks/chat/changes'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { ChangedFile } from '@sb/core/types/changes'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Redo2Icon,
  Undo2Icon,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { useGrowOnly } from '../grow-only'
import {
  useMessageList,
  usePendingMessageLayout,
} from '../message-list/message-list-context'
import { ChangeDiff, ChangeDiffPreview } from './change-diff'
import { ChangeNotice } from './change-notice'

export function ChangesSummary({
  messageId,
  version,
}: {
  messageId: string
  version: number
}) {
  const { summary, files, loadMore, fileStatus, act, error } = useTurnChanges(
    messageId,
    version,
  )
  const growOnly = useGrowOnly()
  const messageList = useMessageList()
  const [showAll, setShowAll] = useState(false)
  const [expanded, setExpanded] = useState<string>()
  const [hovered, setHovered] = useState<string>()
  const loadsFiles =
    summary?.phase === 'ready' || summary?.phase === 'restoring'
  const loadingFiles = loadsFiles && fileStatus === 'LoadingFirstPage'
  usePendingMessageLayout(summary === undefined || loadingFiles)

  useEffect(() => {
    if (showAll && fileStatus === 'CanLoadMore') loadMore(100)
  }, [showAll, fileStatus, loadMore])

  useEffect(() => {
    growOnly?.release()
  }, [expanded, showAll, summary?.phase, growOnly])

  if (!summary) return null
  if (summary.phase === 'ready' && !summary.fileCount) return null

  const pending = summary.phase === 'capturing' || summary.phase === 'queued'
  const restoring = summary.phase === 'restoring'
  const unavailable = summary.phase === 'unavailable'
  const reverted = summary.state === 'reverted'
  const visible = showAll ? files : files.slice(0, 5)
  const remaining = summary.fileCount - 5
  const problem = error ?? summary.error

  return (
    <section
      aria-label="Agent changes"
      className="bg-m3-surface-container-low border-input/50 my-3 mt-5 w-full min-w-0 rounded-lg border p-4 text-sm sm:p-5"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">
            {pending
              ? 'Summarizing changes…'
              : unavailable
                ? 'Changes summary unavailable'
                : 'Changes made'}
          </div>
          {!pending && !unavailable && (
            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span>
                {summary.fileCount} {summary.fileCount === 1 ? 'file' : 'files'}
              </span>
              <LineCounts
                additions={summary.additions}
                deletions={summary.deletions}
              />
            </div>
          )}
        </div>
        {!pending && !unavailable && summary.fileCount > 0 && (
          <RippleButton
            variant="input"
            size="default"
            disabled={restoring || !summary.canRestore}
            onClick={() => void act()}
          >
            {reverted ? <Redo2Icon /> : <Undo2Icon />}
            {restoring
              ? 'Applying…'
              : reverted
                ? 'Reapply changes'
                : 'Revert changes'}
          </RippleButton>
        )}
      </div>
      <Accordion
        aria-busy={loadingFiles}
        className="border-border ml-1 w-auto border-l pl-5"
        multiple={false}
        value={expanded ? [expanded] : []}
        onValueChange={(value) => {
          messageList?.onLayoutChange()
          setExpanded(value[0] as string | undefined)
          setHovered(undefined)
        }}
      >
        {loadingFiles && (
          <LoadingFiles count={Math.min(summary.fileCount, 5)} />
        )}
        {visible.map((file) => (
          <ChangedFileRow
            key={file.key}
            changeSetId={summary._id}
            file={file}
            expanded={expanded === file.key}
            hovered={!expanded && hovered === file.key}
            onHover={(open) => setHovered(open ? file.key : undefined)}
          />
        ))}
      </Accordion>
      {remaining > 0 && (
        <RippleButton
          variant="stealth"
          size="sm"
          className="text-muted-foreground mt-1 ml-6 h-auto max-w-[calc(100%-1.5rem)] justify-start rounded-md px-1 py-2 text-xs font-normal whitespace-normal has-[>svg]:px-1"
          onClick={() => {
            messageList?.onLayoutChange()
            setShowAll(!showAll)
            setExpanded(undefined)
            setHovered(undefined)
          }}
        >
          {showAll
            ? 'Show fewer files'
            : `Show ${remaining} more ${remaining === 1 ? 'file' : 'files'}`}
          <ChevronDownIcon
            aria-hidden
            className={`size-4 ${showAll ? 'rotate-180' : ''}`}
          />
        </RippleButton>
      )}
      {summary.phase === 'ready' && summary.fileCount > 0 && (
        <p
          aria-live="polite"
          className="text-muted-foreground mt-3 flex items-center gap-1.5 text-xs"
        >
          {reverted ? (
            <Undo2Icon aria-hidden className="size-3" />
          ) : (
            <CheckIcon aria-hidden className="size-3" />
          )}
          {reverted ? 'Changes reverted' : 'Applied'}
        </p>
      )}
      {summary.issues.length > 0 && (
        <ChangeNotice
          role="status"
          message="Some files were skipped. Other files can still be restored."
          warning
          details={summary.issues}
        />
      )}
      {problem && <ChangeNotice message={problem} />}
      {summary.conflicts.length > 0 && (
        <ChangeNotice
          message="No files were changed. These files have newer edits:"
          details={summary.conflicts}
        />
      )}
    </section>
  )
}

/** Reserves the same responsive row heights while the first file page loads. */
function LoadingFiles({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <div key={index} aria-hidden className="flex min-h-10 items-center py-2">
      <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
        <Skeleton className="h-5 w-24 rounded-sm" />
        <Skeleton className="h-4 w-40 rounded-sm" />
      </div>
    </div>
  ))
}

type ChangedFileRowProps = {
  changeSetId: Id<'changeSets'>
  file: ChangedFile
  expanded: boolean
  hovered: boolean
  onHover: (open: boolean) => void
}

function ChangedFileRow({
  changeSetId,
  file,
  expanded,
  hovered,
  onHover,
}: ChangedFileRowProps) {
  const [pointerInside, setPointerInside] = useState(false)
  const [animating, setAnimating] = useState(false)
  usePendingMessageLayout(animating)
  const slash = file.path.lastIndexOf('/')
  const directory = file.path.slice(0, slash + 1)
  const filename = file.path.slice(slash + 1)
  return (
    <Accordion.Item value={file.key} className="relative min-w-0">
      <span
        aria-hidden
        className="bg-muted-foreground ring-m3-surface-container-low group-data-open/accordion-item:bg-primary absolute top-4.5 -left-5.75 size-1.5 rounded-full ring-4"
      />
      <Popover
        open={hovered}
        onOpenChange={(open, details) => {
          if (details.reason === 'trigger-press') {
            details.cancel()
            onHover(false)
            return
          }
          onHover(open)
        }}
      >
        <Popover.Trigger
          openOnHover
          delay={400}
          closeDelay={150}
          nativeButton={false}
          tabIndex={-1}
          role="presentation"
          render={<div className="w-full" />}
          onMouseEnter={() => setPointerInside(true)}
          onMouseLeave={() => setPointerInside(false)}
        >
          <Accordion.Trigger
            render={<Button variant="plain" />}
            aria-label={file.path}
            className="hover:text-primary h-auto min-h-10 min-w-0 gap-2 rounded-none! border-0 bg-transparent px-0 py-2 text-sm font-normal hover:bg-transparent focus-visible:ring-0 has-[>svg]:px-0"
          >
            <span className="flex min-w-0 flex-1 flex-col text-left sm:flex-row sm:items-baseline sm:gap-2">
              <span className="max-w-full truncate">{filename}</span>
              {directory && (
                <span className="text-muted-foreground min-w-0 truncate text-xs">
                  {directory}
                </span>
              )}
            </span>
            {file.kind !== 'modified' && (
              <span className="text-muted-foreground text-xs">
                {file.kind === 'added' ? 'Added' : 'Deleted'}
              </span>
            )}
            {file.binary ? (
              <span className="text-muted-foreground text-xs">Binary</span>
            ) : (
              <LineCounts
                additions={file.additions}
                deletions={file.deletions}
              />
            )}
            <ChevronRightIcon
              aria-hidden
              className="text-muted-foreground size-3.5 transition-transform group-data-open/accordion-item:rotate-90 motion-reduce:transition-none"
            />
          </Accordion.Trigger>
        </Popover.Trigger>
        <ChangeDiffPreview
          changeSetId={changeSetId}
          file={file}
          active={!expanded && (hovered || pointerInside)}
        />
      </Popover>
      <Accordion.Content
        className="rounded-none! border-0 pt-0 pb-0"
        onHeightAnimationStart={() => setAnimating(true)}
        onHeightAnimationComplete={() => setAnimating(false)}
      >
        <div className="border-border mb-2 overflow-hidden rounded-md border">
          <ChangeDiff changeSetId={changeSetId} file={file} active={expanded} />
        </div>
      </Accordion.Content>
    </Accordion.Item>
  )
}

function LineCounts({
  additions,
  deletions,
}: {
  additions: number
  deletions: number
}) {
  return (
    <span className="inline-flex shrink-0 gap-1.5 font-mono text-xs tabular-nums">
      <span className="text-green-700 dark:text-green-400">+{additions}</span>
      <span className="text-red-700 dark:text-red-400">−{deletions}</span>
    </span>
  )
}
