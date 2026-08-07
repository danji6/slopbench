import {
  ExternalLink,
  Popover,
  RippleButton,
  type RippleButtonProps,
} from '@/components/ui'
import { useUpdateCheck } from '@/hooks/chat/update'
import { cn } from '@/lib/utils'
import { ArrowUpCircleIcon } from 'lucide-react'

export type UpdateButtonProps = RippleButtonProps & {
  collapsed?: boolean
}

/** Notifies the user when an update is available. */
export function UpdateButton({
  collapsed = false,
  className,
  ...props
}: UpdateButtonProps) {
  const { available, current, latest, notes, publishedAt, url } =
    useUpdateCheck()

  if (!available) return null

  return (
    <Popover>
      <Popover.Trigger
        render={
          <RippleButton
            {...props}
            variant="stealth"
            size={!collapsed ? 'default' : 'icon'}
            aria-label={`Update to version ${latest}`}
            className={cn(
              'text-m3-primary rounded-full',
              !collapsed &&
                'focus-visible:border-ring h-11 w-full justify-center rounded-md font-bold focus-visible:border focus-visible:ring-0',
              className,
            )}
          />
        }
      >
        <ArrowUpCircleIcon />
        {!collapsed && <span>Update</span>}
      </Popover.Trigger>

      <Popover.Content align="end" side={collapsed ? 'right' : 'top'}>
        <Popover.Header>
          <Popover.Title>Version {latest} is available</Popover.Title>
          <Popover.Description>
            You are on {current}
            {publishedAt && ` · released ${formatDate(publishedAt)}`}
          </Popover.Description>
        </Popover.Header>

        {notes && (
          <div className="max-h-56 overflow-y-auto text-xs whitespace-pre-wrap">
            {notes.trim()}
          </div>
        )}

        <p className="text-muted-foreground text-xs">
          Restart the app to install it.
        </p>

        {url && (
          <ExternalLink
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-xs"
          >
            View the full release
          </ExternalLink>
        )}
      </Popover.Content>
    </Popover>
  )
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
}
