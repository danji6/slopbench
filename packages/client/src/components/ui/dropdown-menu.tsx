
import { cn } from '@/lib/utils'
import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { CheckIcon, ChevronRightIcon } from 'lucide-react'

import { Switch } from './switch'

function DropdownMenuRoot({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  align = 'start',
  alignOffset = 0,
  side = 'bottom',
  sideOffset = 4,
  className,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    'align' | 'alignOffset' | 'side' | 'sideOffset'
  >) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="isolate z-60 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            'bg-popover text-popover-foreground ring-foreground/10 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 z-50 max-h-(--available-height) w-(--anchor-width) min-w-40 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md p-1 shadow-md ring-1 duration-100 outline-none data-closed:overflow-hidden',
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        'text-muted-foreground px-2 py-2 text-xs font-medium data-inset:pl-8',
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuItem({
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
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/dropdown-menu-item focus:bg-m3-surface-container-high focus:text-foreground not-data-[variant=destructive]:focus:**:text-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:*:[svg]:text-destructive relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-inset:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "focus:bg-m3-surface-container-high focus:text-foreground not-data-[variant=destructive]:focus:**:text-foreground data-popup-open:bg-m3-surface-container-high data-popup-open:text-foreground data-open:bg-m3-surface-container-high data-open:text-foreground flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm outline-hidden select-none data-inset:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  align = 'start',
  alignOffset = -3,
  side = 'right',
  sideOffset = 0,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        'bg-popover text-popover-foreground ring-foreground/10 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 w-auto min-w-24 rounded-md p-1 shadow-lg ring-1 duration-100',
        className,
      )}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: MenuPrimitive.CheckboxItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        'group/checkbox-item focus:bg-m3-surface-container-high relative flex cursor-pointer items-center gap-2 rounded-sm py-2 pr-10 pl-2.5 text-sm outline-hidden transition-colors select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-inset:pl-8',
        className,
      )}
      checked={checked}
      {...props}
    >
      <span
        className="border-m3-outline group-data-checked/checkbox-item:bg-m3-primary group-data-checked/checkbox-item:border-m3-primary pointer-events-none absolute right-2 flex size-5 items-center justify-center rounded-sm border-2 transition-all"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon className="text-m3-on-primary animate-in fade-in zoom-in-50 size-3.5 duration-200" />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return (
    <MenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: MenuPrimitive.RadioItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        'group/radio-item focus:bg-m3-surface-container-high relative flex cursor-pointer items-center gap-2 rounded-sm py-2 pr-10 pl-2.5 text-sm outline-hidden transition-colors select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-inset:pl-8',
        className,
      )}
      {...props}
    >
      <span
        className="border-m3-outline group-data-checked/radio-item:border-m3-primary pointer-events-none absolute right-2 flex size-5 items-center justify-center rounded-full border-2 transition-colors"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <MenuPrimitive.RadioItemIndicator>
          <div className="bg-m3-primary animate-in fade-in zoom-in-50 size-2.5 rounded-full duration-200" />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function DropdownMenuSwitch({
  className,
  children,
  checked,
  onCheckedChange,
  inset,
  ...props
}: MenuPrimitive.Item.Props & {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  inset?: boolean
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-switch"
      data-inset={inset}
      className={cn(
        'focus:bg-m3-surface-container-high relative flex cursor-pointer items-center justify-between gap-4 rounded-sm px-2.5 py-2 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-inset:pl-8',
        className,
      )}
      closeOnClick={false}
      onClick={() => onCheckedChange?.(!checked)}
      {...props}
    >
      {children}
      <Switch checked={checked} size="sm" />
    </MenuPrimitive.Item>
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('bg-border -mx-1 my-1 h-px', className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        'text-muted-foreground group-focus/dropdown-menu-item:text-foreground ml-auto text-xs tracking-widest',
        className,
      )}
      {...props}
    />
  )
}

export const DropdownMenu = Object.assign(DropdownMenuRoot, {
  Portal: DropdownMenuPortal,
  Trigger: DropdownMenuTrigger,
  Content: DropdownMenuContent,
  Group: DropdownMenuGroup,
  Label: DropdownMenuLabel,
  Item: DropdownMenuItem,
  CheckboxItem: DropdownMenuCheckboxItem,
  RadioGroup: DropdownMenuRadioGroup,
  RadioItem: DropdownMenuRadioItem,
  Switch: DropdownMenuSwitch,
  Separator: DropdownMenuSeparator,
  Shortcut: DropdownMenuShortcut,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
})
