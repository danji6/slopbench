import { cn } from '@/lib/utils'
import { type VariantProps, cva } from 'class-variance-authority'
import type * as React from 'react'

import { Input, RippleButton, Textarea } from '.'

const inputGroupVariants = cva(
  cn(
    'bg-m3-surface-container-low group/input-group border-input relative flex w-full min-w-0 items-center border shadow-xs transition-[color,box-shadow,border] outline-none',
    'data-[disabled=true]:pointer-events-none data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50',

    // Variants based on children
    'h-11 has-[>input]:rounded-full',
    'has-[>textarea]:h-auto has-[>textarea]:rounded-2xl',

    // Variants based on alignment
    'has-[>[data-align=inline-start]]:*:data-[slot=input-group-control]:pl-2',
    'has-[>[data-align=inline-end]]:*:data-[slot=input-group-control]:pr-2',
    'has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-start]]:*:data-[slot=input-group-control]:pb-3',
    'has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-end]]:*:data-[slot=input-group-control]:pt-3',

    // Error state
    'has-[[data-slot][aria-invalid=true]]:ring-destructive/20 has-[[data-slot][aria-invalid=true]]:border-destructive dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40',
  ),
  {
    variants: {
      variant: {
        default: null,
        outline: cn(
          // Hover state
          'hover:border-ring',

          // Focus state
          'has-[[data-slot=input-group-control]:focus-within]:border-ring has-[[data-slot=input-group-control]:focus-within]:ring-ring has-[[data-slot=input-group-control]:focus-within]:ring-1',
        ),
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

type InputGroupProps = React.ComponentProps<'fieldset'> &
  VariantProps<typeof inputGroupVariants>

function InputGroupRoot({ variant, className, ...props }: InputGroupProps) {
  return (
    <fieldset
      data-slot="input-group"
      data-disabled={props.disabled}
      className={cn(inputGroupVariants({ variant }), className)}
      {...props}
    />
  )
}

const inputGroupAddonVariants = cva(
  "text-muted-foreground flex h-auto min-w-0 cursor-text items-center justify-center gap-2 px-3 text-sm font-medium select-none group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-[calc(var(--radius)-5px)] [&>svg:not([class*='size-'])]:size-4",
  {
    variants: {
      align: {
        'inline-start':
          'order-first pl-3 has-[>button]:-ml-2 has-[>kbd]:ml-[-0.35rem]',
        'inline-end':
          'order-last pr-3 has-[>button]:-mr-2 has-[>kbd]:mr-[-0.35rem]',
        'block-start':
          'order-first w-full justify-start pt-3 group-has-[>input]/input-group:pt-2.5 [.border-b]:pb-3',
        'block-end':
          'order-last w-full justify-start pb-3 group-has-[>input]/input-group:pb-2.5 [.border-t]:pt-3',
      },
    },
    defaultVariants: {
      align: 'inline-start',
    },
  },
)

function InputGroupAddon({
  className,
  align = 'inline-start',
  ...props
}: React.ComponentProps<'fieldset'> &
  VariantProps<typeof inputGroupAddonVariants>) {
  function handleClick(e: React.MouseEvent<HTMLFieldSetElement>) {
    if ((e.target as HTMLElement).closest('button,input,textarea,select')) {
      return
    }
    e.currentTarget.parentElement
      ?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        '[data-slot=input-group-control]',
      )
      ?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLFieldSetElement>) {
    // Trigger click behavior on Enter or Space key
    if (e.key === 'Enter' || e.key === ' ') {
      if ((e.target as HTMLElement).closest('button,input,textarea,select')) {
        return
      }
      e.preventDefault()
      e.currentTarget.parentElement
        ?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
          '[data-slot=input-group-control]',
        )
        ?.focus()
    }
  }

  return (
    <fieldset
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      {...props}
    />
  )
}

function InputGroupButton({
  className,
  type = 'button',
  variant = 'surface',
  size = 'icon',
  ...props
}: React.ComponentProps<typeof RippleButton>) {
  return (
    <RippleButton
      type={type}
      data-size={size}
      size={size}
      variant={variant}
      className={cn('size-8.5', className)}
      {...props}
    />
  )
}

function InputGroupText({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        "text-muted-foreground flex items-center gap-2 text-sm [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<'input'>) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        'h-10.5 min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0',
        className,
      )}
      {...props}
    />
  )
}

function InputGroupTextarea({
  className,
  ...props
}: React.ComponentProps<'textarea'>) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(
        'min-w-0 grow resize-none rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0',
        className,
      )}
      {...props}
    />
  )
}

export const InputGroup = Object.assign(InputGroupRoot, {
  Addon: InputGroupAddon,
  Button: InputGroupButton,
  Text: InputGroupText,
  Input: InputGroupInput,
  Textarea: InputGroupTextarea,
})

export type { InputGroupProps }
