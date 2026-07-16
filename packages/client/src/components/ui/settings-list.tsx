import { useRipples } from '@/hooks/ripples'
import { cn } from '@/lib/utils'
import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import * as React from 'react'

import { Checkbox } from './checkbox'
import { Combobox } from './combobox'
import { HelpPopoverLabel } from './help'
import { Label } from './label'
import { ParamInput } from './param-input'
import { ParamNumberInput } from './param-number-input'
import { ParamSlider } from './param-slider'
import { ParamTextarea } from './param-textarea'
import { Select } from './select'
import { Switch } from './switch'

interface SettingsListItemProps extends React.ComponentProps<'div'> {
  label?: React.ReactNode
  help?: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  unclickable?: boolean
  unhoverable?: boolean
  disabled?: boolean
  contentClassName?: string
  orientation?: 'horizontal' | 'vertical'
}

function SettingsListRoot({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="settings-list"
      className={cn(
        'divide-border/10 flex w-full flex-col divide-y',
        className,
      )}
    >
      {children}
    </div>
  )
}

function SettingsListItem({
  label,
  help,
  description,
  children,
  className,
  contentClassName,
  unclickable,
  unhoverable,
  disabled = false,
  orientation = 'horizontal',
  ref,
  ...props
}: SettingsListItemProps) {
  const internalRef = React.useRef<HTMLDivElement>(null)
  React.useImperativeHandle(ref, () => internalRef.current as HTMLDivElement)
  const ripples = useRipples(internalRef, { variant: 'stealth' })

  const isHorizontal = !!label && orientation === 'horizontal'

  return (
    <div
      data-slot="settings-list-item"
      ref={internalRef}
      className={cn(
        'relative isolate flex overflow-hidden px-4 py-3 transition-colors select-none',
        ...(disabled
          ? ['cursor-not-allowed opacity-50']
          : [
              !unhoverable && 'hover:bg-m3-surface-container-high/70',
              unclickable && unhoverable && 'hover:bg-m3-surface-container/50',
              !unclickable && 'cursor-pointer',
            ]),
        isHorizontal ? 'items-center justify-between gap-4' : 'flex-col gap-2',
        className,
      )}
      {...props}
    >
      {!unclickable && !disabled && ripples}
      {label && (
        <div className="pointer-events-none flex flex-col gap-0.5">
          <HelpPopoverLabel help={help}>{label}</HelpPopoverLabel>
          {description && (
            <div className="text-muted-foreground text-sm leading-normal">
              {description}
            </div>
          )}
        </div>
      )}
      {children && (
        <div
          className={cn(
            disabled ? 'pointer-events-none' : 'pointer-events-auto',
            isHorizontal
              ? 'flex shrink-0 items-center justify-center'
              : 'flex w-full flex-col gap-2',
            contentClassName,
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

const SettingsListSwitch = ({
  label,
  description,
  checked,
  onCheckedChange,
  className,
  disabled,
  ...props
}: SettingsListItemProps & {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}) => {
  return (
    <SettingsListItem
      label={label}
      description={description}
      className={className}
      onClick={() => !disabled && onCheckedChange?.(!checked)}
      disabled={disabled}
      {...props}
    >
      <Switch checked={checked} disabled={disabled} />
    </SettingsListItem>
  )
}

const SettingsListCheckbox = ({
  label,
  description,
  checked,
  indeterminate,
  onCheckedChange,
  className,
  disabled,
  ...props
}: SettingsListItemProps & {
  checked?: boolean
  indeterminate?: boolean
  onCheckedChange?: (checked: boolean) => void
}) => {
  return (
    <SettingsListItem
      label={label}
      description={description}
      className={className}
      onClick={() => !disabled && onCheckedChange?.(!checked)}
      disabled={disabled}
      {...props}
    >
      <Checkbox
        checked={checked}
        indeterminate={indeterminate}
        disabled={disabled}
        readOnly
      />
    </SettingsListItem>
  )
}

const SettingsListRadioGroup = RadioGroupPrimitive

const SettingsListRadioItem = ({
  label,
  description,
  value,
  className,
  ...props
}: Omit<RadioPrimitive.Root.Props, 'children' | 'render'> & {
  label: React.ReactNode
  description?: React.ReactNode
}) => {
  const ref = React.useRef<HTMLDivElement>(null)
  const ripples = useRipples(ref, { variant: 'stealth' })

  return (
    <RadioPrimitive.Root
      value={value}
      className="group/radio-item w-full outline-none"
      {...props}
      render={
        <div
          ref={ref}
          className={cn(
            'hover:bg-m3-surface-container-high active:bg-m3-surface-container-highest relative isolate flex cursor-pointer items-center justify-between gap-4 overflow-hidden px-4 py-3 transition-colors select-none',
            className,
          )}
        >
          {ripples}
          <div className="pointer-events-none flex flex-col gap-0.5">
            <Label>{label}</Label>
            {description && (
              <p className="text-muted-foreground text-xs leading-normal">
                {description}
              </p>
            )}
          </div>
          <div className="border-m3-outline group-data-checked/radio-item:border-m3-primary relative flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors">
            <RadioPrimitive.Indicator className="flex size-full items-center justify-center">
              <div className="bg-m3-primary animate-in fade-in zoom-in-50 size-2.5 rounded-full duration-200" />
            </RadioPrimitive.Indicator>
          </div>
        </div>
      }
    />
  )
}

const SettingsListSlider = ({
  className,
  thumbClassName,
  disabled,
  ...props
}: Omit<React.ComponentProps<typeof ParamSlider>, 'className'> & {
  className?: string
  clickable?: boolean
}) => {
  return (
    <SettingsListItem
      unclickable
      unhoverable
      disabled={disabled}
      className={cn('group/settings-item block', className)}
    >
      <ParamSlider
        {...(props as React.ComponentProps<typeof ParamSlider>)}
        disabled={disabled}
        thumbClassName={thumbClassName}
      />
    </SettingsListItem>
  )
}

const SettingsListInput = ({
  className,
  clickable: _clickable,
  disabled,
  ...props
}: Omit<React.ComponentProps<typeof ParamInput>, 'className'> & {
  className?: string
  clickable?: boolean
}) => {
  return (
    <SettingsListItem
      className={cn('group/settings-item block', className)}
      unclickable
      disabled={disabled}
    >
      <ParamInput {...props} disabled={disabled} />
    </SettingsListItem>
  )
}

const SettingsListTextarea = ({
  className,
  clickable: _clickable,
  disabled,
  ...props
}: Omit<React.ComponentProps<typeof ParamTextarea>, 'className'> & {
  className?: string
  clickable?: boolean
}) => {
  return (
    <SettingsListItem
      className={cn('group/settings-item block', className)}
      unclickable
      disabled={disabled}
    >
      <ParamTextarea {...props} disabled={disabled} />
    </SettingsListItem>
  )
}

const SettingsNumberInput = ({
  className,
  disabled,
  description,
  ...props
}: Omit<React.ComponentProps<typeof ParamNumberInput>, 'className'> & {
  className?: string
  clickable?: boolean
}) => {
  return (
    <SettingsListItem
      unclickable
      disabled={disabled}
      className={cn('group/settings-item block', className)}
    >
      <ParamNumberInput
        {...props}
        description={description}
        disabled={disabled}
      />
    </SettingsListItem>
  )
}

const SettingsListCombobox = ({
  label,
  help,
  description,
  value,
  onValueChange,
  noDeselect,
  allowCustom,
  placeholder = 'Select...',
  renderValue,
  children,
  className,
  contentClassName,
  triggerClassName,
  disabled,
  ...props
}: Omit<SettingsListItemProps, 'value' | 'onChange'> & {
  value?: string
  onValueChange?: (value: string) => void
  noDeselect?: boolean
  allowCustom?: boolean
  placeholder?: string
  renderValue?: (value: string | undefined) => React.ReactNode
  triggerClassName?: string
  contentClassName?: string
}) => {
  return (
    <SettingsListItem
      label={label}
      help={help}
      description={description}
      unclickable
      unhoverable
      disabled={disabled}
      className={className}
      {...props}
    >
      <Combobox
        value={value}
        onValueChange={onValueChange}
        noDeselect={noDeselect}
        allowCustom={allowCustom}
      >
        <Combobox.Trigger
          variant="input"
          disabled={disabled}
          className={cn(
            'text-muted-foreground w-48 max-w-full',
            triggerClassName,
          )}
        >
          <Combobox.DisplayValue placeholder={placeholder}>
            {renderValue}
          </Combobox.DisplayValue>
        </Combobox.Trigger>
        <Combobox.Content align="end" className={contentClassName}>
          <Combobox.Search />
          <Combobox.List>
            <Combobox.Empty>No options found.</Combobox.Empty>
            {children}
            {allowCustom && <Combobox.CustomItem />}
          </Combobox.List>
        </Combobox.Content>
      </Combobox>
    </SettingsListItem>
  )
}

const SettingsListSelect = ({
  label,
  help,
  description,
  value,
  onValueChange,
  placeholder = 'Select...',
  children,
  className,
  disabled,
  ...props
}: Omit<SettingsListItemProps, 'value' | 'onChange'> & {
  value?: string
  onValueChange?: (value: string) => void
  placeholder?: string
}) => {
  let displayLabel: React.ReactNode = placeholder
  React.Children.forEach(children, (child) => {
    if (
      React.isValidElement<{ value?: string; children?: React.ReactNode }>(
        child,
      ) &&
      child.props.value === value
    ) {
      displayLabel = child.props.children
    }
  })

  return (
    <SettingsListItem
      label={label}
      help={help}
      description={description}
      unclickable
      unhoverable
      disabled={disabled}
      className={className}
      {...props}
    >
      <Select value={value} onValueChange={(v) => onValueChange?.(v ?? '')}>
        <Select.Trigger
          variant="input"
          disabled={disabled}
          className="text-muted-foreground max-w-full min-w-32"
        >
          {displayLabel}
        </Select.Trigger>
        <Select.Content align="end">{children}</Select.Content>
      </Select>
    </SettingsListItem>
  )
}

export const SettingsList = Object.assign(SettingsListRoot, {
  Item: SettingsListItem,
  Switch: SettingsListSwitch,
  Checkbox: SettingsListCheckbox,
  RadioGroup: SettingsListRadioGroup,
  RadioItem: SettingsListRadioItem,
  Slider: SettingsListSlider,
  Input: SettingsListInput,
  Textarea: SettingsListTextarea,
  NumberInput: SettingsNumberInput,
  Combobox: Object.assign(SettingsListCombobox, {
    Item: Combobox.Item,
  }),
  Select: Object.assign(SettingsListSelect, {
    Item: Select.Item,
  }),
})
