import { cn } from '@/lib/utils'
import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { CheckIcon, ChevronRightIcon, CircleIcon } from 'lucide-react'

function MenuRoot({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="menu" {...props} />
}

function MenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="menu-portal" {...props} />
}

function MenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="menu-trigger" {...props} />
}

function MenuPositioner({
  sideOffset = 4,
  className,
  ...props
}: MenuPrimitive.Positioner.Props) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        data-slot="menu-positioner"
        sideOffset={sideOffset}
        className={cn('z-50', className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  )
}

function MenuContent({ className, ...props }: MenuPrimitive.Popup.Props) {
  return (
    <MenuPrimitive.Popup
      data-slot="menu-content"
      className={cn(
        'bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--available-height) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md',
        className,
      )}
      {...props}
    />
  )
}

function MenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="menu-group" {...props} />
}

function MenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean
  variant?: 'default' | 'destructive'
}) {
  return (
    <MenuPrimitive.Item
      data-slot="menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 [variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:text-destructive! [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-inset:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

function MenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: MenuPrimitive.CheckboxItem.Props) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="menu-checkbox-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon className="size-4" />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function MenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot="menu-radio-group" {...props} />
}

function MenuRadioItem({
  className,
  children,
  ...props
}: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="menu-radio-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <MenuPrimitive.RadioItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function MenuLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="menu-label"
      data-inset={inset}
      className={cn(
        'px-2 py-1.5 text-sm font-medium data-inset:pl-8',
        className,
      )}
      {...props}
    />
  )
}

function MenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="menu-separator"
      className={cn('bg-border -mx-1 my-1 h-px', className)}
      {...props}
    />
  )
}

function MenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="menu-shortcut"
      className={cn(
        'text-muted-foreground ml-auto text-xs tracking-widest',
        className,
      )}
      {...props}
    />
  )
}

function MenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="menu-sub" {...props} />
}

function MenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground data-[variant=destructive]:*:[svg]:text-destructive! [&_svg:not([class*='text-'])]:text-muted-foreground flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-inset:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function MenuSubContent({ className, ...props }: MenuPrimitive.Popup.Props) {
  return (
    <MenuPrimitive.Popup
      data-slot="menu-sub-content"
      className={cn(
        'bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-32 origin-(--transform-origin) overflow-hidden rounded-md border p-1 shadow-lg',
        className,
      )}
      {...props}
    />
  )
}

export const Menu = {
  Root: MenuRoot,
  Portal: MenuPortal,
  Trigger: MenuTrigger,
  Positioner: MenuPositioner,
  Content: MenuContent,
  Group: MenuGroup,
  Label: MenuLabel,
  Item: MenuItem,
  CheckboxItem: MenuCheckboxItem,
  RadioGroup: MenuRadioGroup,
  RadioItem: MenuRadioItem,
  Separator: MenuSeparator,
  Shortcut: MenuShortcut,
  Sub: MenuSub,
  SubTrigger: MenuSubTrigger,
  SubContent: MenuSubContent,
}
