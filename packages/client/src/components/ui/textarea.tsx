import { cn } from '@/lib/utils'
import { type VariantProps, cva } from 'class-variance-authority'
import { useEffect, useRef } from 'react'

const textareaVariants = cva(
  'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive border-input placeholder:text-muted-foreground bg-m3-surface-container-low flex min-h-16 w-full min-w-0 resize-none rounded-2xl border px-4 py-2 text-base wrap-break-word shadow-xs transition-[color,box-shadow,border] outline-none disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: null,
        outline: 'hover:border-ring focus-visible:border-ring',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

type TextareaProps = React.ComponentProps<'textarea'> &
  VariantProps<typeof textareaVariants>

function Textarea({
  value,
  onChange,
  variant,
  className,
  ref: forwardedRef,
  ...props
}: TextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  function resize() {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const { maxHeight, borderTopWidth, borderBottomWidth } =
      getComputedStyle(el)
    const cap = maxHeight === 'none' ? Infinity : parseFloat(maxHeight)
    const border = parseFloat(borderTopWidth) + parseFloat(borderBottomWidth)
    el.style.height = `${Math.min(el.scrollHeight + border, cap)}px`
  }

  useEffect(resize, [value])

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    resize()
    onChange?.(e)
  }

  return (
    <textarea
      ref={(el) => {
        ref.current = el
        if (typeof forwardedRef === 'function') forwardedRef(el)
        else if (forwardedRef) forwardedRef.current = el
      }}
      value={value}
      onChange={handleChange}
      data-slot="textarea"
      className={cn(textareaVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Textarea }
