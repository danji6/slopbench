import { Input, RippleButton } from '@/components/ui'
import { PlusIcon, XIcon } from 'lucide-react'
import { useState } from 'react'

export type ApprovalListProps = {
  values: string[]
  onChange: (values: string[]) => void
  placeholder: string
  label: string
  validate?: (values: string[]) => string | null
}

/** Entry editor shared by shell and path approvals. */
export function ApprovalList({
  values,
  onChange,
  placeholder,
  label,
  validate,
}: ApprovalListProps) {
  const [input, setInput] = useState('')
  const value = input.trim()
  const next = [...values, value]
  const error = value ? validate?.(next) : null
  const disabled = !value || values.includes(value) || Boolean(error)

  function add() {
    if (disabled) return
    onChange(next)
    setInput('')
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            add()
          }}
          placeholder={placeholder}
          aria-label={label}
          aria-invalid={Boolean(error)}
          variant="outline"
          className="h-9 max-w-70 font-mono text-sm"
        />
        <RippleButton
          type="button"
          variant="surface"
          size="icon"
          aria-label={`Add ${label.toLowerCase()}`}
          disabled={disabled}
          onClick={add}
        >
          <PlusIcon />
        </RippleButton>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.map((entry) => (
            <span
              key={entry}
              className="bg-m3-surface-container-high flex max-w-full items-center gap-1.5 rounded-full py-1 pr-2 pl-3 font-mono text-xs"
            >
              <span className="break-all">{entry}</span>
              <button
                type="button"
                aria-label={`Remove ${entry}`}
                className="text-muted-foreground hover:text-foreground flex shrink-0 items-center transition-colors"
                onClick={() =>
                  onChange(values.filter((item) => item !== entry))
                }
              >
                <XIcon className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
