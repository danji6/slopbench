import { mergeProps } from '@base-ui/react'
import { CircleHelpIcon } from 'lucide-react'
import * as React from 'react'

import { Dialog } from './dialog'
import { Label } from './label'
import { Popover } from './popover'

export function HelpButton({ children }: { children: React.ReactNode }) {
  return (
    <Popover>
      <Popover.Trigger render={<HelpTrigger />} />
      <Popover.Content>{children}</Popover.Content>
    </Popover>
  )
}

export function HelpDialogButton({
  children,
  title,
}: {
  children: React.ReactNode
  title?: React.ReactNode
}) {
  return (
    <Dialog>
      <Dialog.Trigger render={<HelpTrigger />} />
      <Dialog.Content className="flex max-h-[calc(100svh-4rem)] flex-col sm:max-w-2xl">
        {title && (
          <Dialog.Header>
            <Dialog.Title>{title}</Dialog.Title>
          </Dialog.Header>
        )}
        <div className="h-full flex-1 overflow-y-auto">{children}</div>
      </Dialog.Content>
    </Dialog>
  )
}

export function HelpDialogLabel({
  children,
  help,
  title,
  ...props
}: {
  children: React.ReactNode
  help?: React.ReactNode
  title?: React.ReactNode
} & React.ComponentProps<typeof Label>) {
  if (!help) return <Label {...props}>{children}</Label>

  return (
    <div className="flex items-center gap-1.5">
      <Label {...props}>{children}</Label>
      <HelpDialogButton title={title}>{help}</HelpDialogButton>
    </div>
  )
}

export function HelpPopoverLabel({
  children,
  help,
  ...props
}: {
  children: React.ReactNode
  help?: React.ReactNode
  variant?: 'default' | 'settings'
} & React.ComponentProps<typeof Label>) {
  if (!help) return <Label {...props}>{children}</Label>

  return (
    <div data-slot="help-label" className="flex items-center gap-1.5">
      <Label {...props}>{children}</Label>
      <HelpButton>{help}</HelpButton>
    </div>
  )
}

function HelpTrigger(props: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className="text-muted-foreground hover:text-foreground focus-visible:border-ring pointer-events-auto flex size-4 cursor-pointer items-center justify-center rounded-full border border-transparent transition-colors outline-none"
      {...mergeProps(
        { onClick: (e: React.SyntheticEvent) => e.stopPropagation() },
        props,
      )}
    >
      <CircleHelpIcon className="size-4" />
    </button>
  )
}
