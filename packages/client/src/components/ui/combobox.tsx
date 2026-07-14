import { cn } from '@/lib/utils'
import { mergeProps } from '@base-ui/react'
import { ChevronsUpDownIcon } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react'

import { Command } from './command'
import { Popover } from './popover'
import { RippleButton, type RippleButtonProps } from './ripple-button'

interface ComboboxContextValue {
  value?: string
  onValueChange?: (value: string) => void
  open: boolean
  setOpen: (open: boolean) => void
  labels: Map<string, React.ReactNode>
  registerLabel: (value: string, label: React.ReactNode) => () => void
  noDeselect?: boolean
  allowCustom: boolean
  searchValue: string
  setSearchValue: (v: string) => void
}

const ComboboxContext = createContext<ComboboxContextValue | null>(null)

function useComboboxContext() {
  const context = useContext(ComboboxContext)
  if (!context) {
    throw new Error('Combobox components must be used within a Combobox.Root')
  }
  return context
}

interface ComboboxRootProps {
  children?: React.ReactNode
  value?: string
  onValueChange?: (value: string) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onOpenChangeComplete?: (open: boolean) => void
  defaultOpen?: boolean
  noDeselect?: boolean
  allowCustom?: boolean
}

function ComboboxRoot({
  children,
  value,
  onValueChange,
  open: openProp,
  onOpenChange,
  onOpenChangeComplete,
  defaultOpen = false,
  noDeselect = false,
  allowCustom = false,
}: ComboboxRootProps) {
  const [openState, setOpenState] = useState(defaultOpen)
  const [searchValue, setSearchValue] = useState('')
  const open = openProp ?? openState

  const setOpen = useCallback(
    (newOpen: boolean) => {
      setOpenState(newOpen)
      onOpenChange?.(newOpen)
      if (!newOpen) setSearchValue('')
    },
    [onOpenChange],
  )

  const [labels] = useState(() => new Map<string, React.ReactNode>())
  const [, forceUpdate] = useReducer((x) => x + 1, 0)

  const registerLabel = useCallback(
    (val: string, label: React.ReactNode) => {
      labels.set(val, label)
      forceUpdate()
      return () => {
        labels.delete(val)
        forceUpdate()
      }
    },
    [labels],
  )

  const contextValue = useMemo(
    () => ({
      value,
      onValueChange,
      open,
      setOpen,
      labels,
      registerLabel,
      noDeselect,
      allowCustom,
      searchValue,
      setSearchValue,
    }),
    [
      value,
      onValueChange,
      open,
      setOpen,
      labels,
      registerLabel,
      noDeselect,
      allowCustom,
      searchValue,
    ],
  )

  return (
    <ComboboxContext.Provider value={contextValue}>
      <Popover
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={onOpenChangeComplete}
      >
        {children}
      </Popover>
    </ComboboxContext.Provider>
  )
}

type ComboboxTriggerProps = RippleButtonProps

function ComboboxTrigger({
  className,
  variant = 'input',
  size = 'default',
  children,
  ...props
}: ComboboxTriggerProps) {
  const { open } = useComboboxContext()

  return (
    <Popover.Trigger
      role="combobox"
      aria-expanded={open}
      className={cn(
        'flex w-full items-center justify-between font-normal *:data-[slot=combobox-value]:block *:data-[slot=combobox-value]:min-w-0 *:data-[slot=combobox-value]:truncate',
        className,
      )}
      {...mergeProps(
        {
          render: <RippleButton variant={variant} size={size} />,
        },
        props,
      )}
    >
      {children}
      <ChevronsUpDownIcon className="text-muted-foreground ml-2 size-4 shrink-0 opacity-50" />
    </Popover.Trigger>
  )
}

interface ComboboxValueProps extends Omit<
  React.ComponentProps<'span'>,
  'children'
> {
  placeholder?: React.ReactNode
  label?: React.ReactNode
  children?: React.ReactNode | ((value?: string) => React.ReactNode)
}

function ComboboxDisplayValue({
  className,
  placeholder,
  label,
  children,
  ...props
}: ComboboxValueProps) {
  const { value, labels } = useComboboxContext()
  const registeredLabel = value ? labels.get(value) : null

  let content: React.ReactNode = label ?? registeredLabel

  if (content === undefined || content === null) {
    if (typeof children === 'function') {
      content = children(value)
    } else {
      content = children ?? value
    }
  }

  return (
    <span
      data-slot="combobox-value"
      className={cn(
        'block min-w-0 flex-1 text-left',
        content == null && 'text-muted-foreground',
        className,
      )}
      {...props}
    >
      {content ?? placeholder}
    </span>
  )
}

type ComboboxContentProps = React.ComponentProps<typeof Popover.Content>

function ComboboxContent({
  className,
  children,
  align = 'start',
  ...props
}: ComboboxContentProps) {
  return (
    <Popover.Content
      className={cn('w-(--anchor-width) min-w-40 p-0', className)}
      align={align}
      {...props}
    >
      <Command>{children}</Command>
    </Popover.Content>
  )
}

function ComboboxSearch({
  placeholder = 'Search...',
  onValueChange,
  ...props
}: React.ComponentProps<typeof Command.CommandInput>) {
  const { allowCustom, searchValue, setSearchValue } = useComboboxContext()

  return (
    <Command.CommandInput
      placeholder={placeholder}
      {...props}
      {...(allowCustom && { value: searchValue })}
      onValueChange={(v) => {
        if (allowCustom) setSearchValue(v)
        onValueChange?.(v)
      }}
    />
  )
}

function ComboboxCustomItem() {
  const { searchValue, setSearchValue, onValueChange, setOpen, labels } =
    useComboboxContext()

  const trimmed = searchValue.trim()
  if (!trimmed || labels.has(trimmed)) return null

  return (
    <Command.CommandItem
      value={trimmed}
      onSelect={() => {
        onValueChange?.(trimmed)
        setSearchValue('')
        setOpen(false)
      }}
      className="text-muted-foreground italic"
    >
      <span className="flex-1 truncate">Use &ldquo;{trimmed}&rdquo;</span>
    </Command.CommandItem>
  )
}

function ComboboxList(props: React.ComponentProps<typeof Command.CommandList>) {
  return <Command.CommandList {...props} />
}

function ComboboxEmpty(
  props: React.ComponentProps<typeof Command.CommandEmpty>,
) {
  return <Command.CommandEmpty {...props} />
}

function ComboboxGroup(
  props: React.ComponentProps<typeof Command.CommandGroup>,
) {
  return <Command.CommandGroup {...props} />
}

type ComboboxItemProps = React.ComponentProps<typeof Command.CommandItem> & {
  keywords?: string[]
}

function ComboboxItem({
  children,
  value: valueProp,
  keywords = [],
  onSelect,
  className,
  ...props
}: ComboboxItemProps) {
  const {
    value: selectedValue,
    onValueChange,
    setOpen,
    registerLabel,
    noDeselect,
  } = useComboboxContext()

  // Register label for the Value component
  useEffect(() => {
    const val =
      valueProp ?? (typeof children === 'string' ? children : undefined)
    if (val) {
      return registerLabel(val, children)
    }
  }, [valueProp, children, registerLabel])

  const searchableValue = useMemo(() => {
    if (!valueProp) return undefined
    const parts = [valueProp]
    if (typeof children === 'string') parts.push(children)
    parts.push(...keywords)
    return parts.filter(Boolean).join(' ')
  }, [valueProp, children, keywords])

  return (
    <Command.CommandItem
      {...props}
      value={searchableValue}
      onSelect={() => {
        if (valueProp) {
          const newValue =
            noDeselect && valueProp === selectedValue
              ? valueProp
              : valueProp === selectedValue
                ? ''
                : valueProp
          setOpen(false)
          onValueChange?.(newValue)
          onSelect?.(valueProp)
          return
        }
        setOpen(false)
      }}
      data-checked={valueProp ? selectedValue === valueProp : false}
      className={className}
    >
      <span className="flex-1 truncate">{children}</span>
    </Command.CommandItem>
  )
}

function ComboboxSeparator(
  props: React.ComponentProps<typeof Command.CommandSeparator>,
) {
  return <Command.CommandSeparator {...props} />
}

export const Combobox = Object.assign(ComboboxRoot, {
  Trigger: ComboboxTrigger,
  DisplayValue: ComboboxDisplayValue,
  Content: ComboboxContent,
  Search: ComboboxSearch,
  List: ComboboxList,
  Empty: ComboboxEmpty,
  Group: ComboboxGroup,
  Item: ComboboxItem,
  CustomItem: ComboboxCustomItem,
  Separator: ComboboxSeparator,
})

export type {
  ComboboxRootProps,
  ComboboxTriggerProps,
  ComboboxValueProps,
  ComboboxContentProps,
  ComboboxItemProps,
}
