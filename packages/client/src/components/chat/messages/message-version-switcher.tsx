import { Popover, RippleButton, ScrollArea } from '@/components/ui'
import { useSelectMessageVersion } from '@/hooks/chat'
import { cn } from '@/lib/utils'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useQuery } from 'convex/react'
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'

type MessageVersionSwitcherProps = {
  messageId: string
  selectedVersion: number
  versionCount: number
  disabled?: boolean
}

export function MessageVersionSwitcher({
  messageId,
  selectedVersion,
  versionCount,
  disabled,
}: MessageVersionSwitcherProps) {
  const select = useSelectMessageVersion()
  const [open, setOpen] = useState(false)
  const liveVersions = useQuery(
    api.chat.listMessageVersions,
    open ? { messageId: messageId as Id<'messages'> } : 'skip',
  )

  // Cache the list so it stays stable
  const [versions, setVersions] = useState(liveVersions)
  if (liveVersions && liveVersions !== versions) setVersions(liveVersions)

  if (versionCount <= 1) return null

  return (
    <div className="text-muted-foreground/80 flex items-center gap-0.5 text-sm">
      <button
        type="button"
        aria-label="Previous version"
        className="hover:text-foreground rounded p-0.5 transition-colors disabled:pointer-events-none disabled:opacity-40"
        disabled={disabled || selectedVersion <= 1}
        onClick={() => select(messageId, selectedVersion - 1)}
      >
        <ChevronLeftIcon className="size-4" />
      </button>

      <Popover open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          disabled={disabled}
          className="hover:text-foreground rounded px-1 tabular-nums transition-colors disabled:pointer-events-none disabled:opacity-40"
        >
          {selectedVersion}/{versionCount}
        </Popover.Trigger>
        <Popover.Content align="center" className="w-80 gap-1 p-1.5">
          <ScrollArea viewportClassName="max-h-80">
            <div className="flex flex-col gap-0.5">
              {versions?.map((version) => (
                <VersionRow
                  key={version.version}
                  version={version.version}
                  preview={version.preview}
                  selected={version.selected}
                  onSelect={() => {
                    select(messageId, version.version)
                    setOpen(false)
                  }}
                />
              ))}
            </div>
          </ScrollArea>
        </Popover.Content>
      </Popover>

      <button
        type="button"
        aria-label="Next version"
        className="hover:text-foreground rounded p-0.5 transition-colors disabled:pointer-events-none disabled:opacity-40"
        disabled={disabled || selectedVersion >= versionCount}
        onClick={() => select(messageId, selectedVersion + 1)}
      >
        <ChevronRightIcon className="size-4" />
      </button>
    </div>
  )
}

type VersionRowProps = {
  version: number
  preview: string
  selected: boolean
  onSelect: () => void
}

function VersionRow({ version, preview, selected, onSelect }: VersionRowProps) {
  return (
    <RippleButton
      variant="stealth"
      className={cn(
        'h-auto w-full flex-col items-stretch gap-1 rounded-md px-2.5 py-2 text-left select-none',
        selected && 'bg-m3-surface-container-high',
      )}
      onClick={onSelect}
    >
      <span className="flex w-full items-center gap-1.5">
        <span className="text-foreground/90 font-medium tabular-nums">
          v{version}
        </span>
        {selected && (
          <CheckIcon className="text-primary ml-auto size-3.5 shrink-0" />
        )}
      </span>
      {preview && (
        <span className="text-muted-foreground line-clamp-3 text-xs leading-snug font-normal wrap-break-word whitespace-pre-wrap">
          {preview}
        </span>
      )}
    </RippleButton>
  )
}
