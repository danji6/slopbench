import type {
  CompletionItem,
  SignatureHelp,
} from '@sb/core/code-completion/types'
import type { Editor } from '@tiptap/react'
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type CompletionPopupProps = {
  editor: Editor
  anchor: number
  id: string
  items: CompletionItem[]
  selected: number
  signature?: SignatureHelp
  onAccept: (item: CompletionItem) => void
  onSelect: (index: number) => void
}

/** Displays caret-anchored suggestions and configured function signatures. */
export function CompletionPopup(props: CompletionPopupProps) {
  const { editor, anchor, id, items, selected, signature, onAccept, onSelect } = props // prettier-ignore
  const container = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })

  useLayoutEffect(() => {
    container.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  useLayoutEffect(() => {
    const reposition = () => {
      if (!container.current || editor.isDestroyed) return

      const coords = editor.view.coordsAtPos(anchor)
      const { width, height } = container.current.getBoundingClientRect()
      const left = Math.max(4, Math.min(coords.left, window.innerWidth - width - 4)) // prettier-ignore
      const below = coords.bottom + 4
      const top =
        below + height <= window.innerHeight
          ? below
          : Math.max(4, coords.top - height - 4)

      setPosition({ left, top })
    }

    reposition()

    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)

    const observer = new ResizeObserver(reposition)
    if (container.current) observer.observe(container.current)

    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [editor, anchor, items, signature])

  return createPortal(
    <div
      ref={container}
      data-slot="code-completion"
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      className="bg-m3-surface-container-low fixed z-55 w-80 max-w-[calc(100vw-8px)] overflow-hidden rounded-xl border shadow-lg"
      style={position}
    >
      {signature && <SignatureHint signature={signature} />}
      {items.length > 0 && (
        <div
          id={id}
          role="listbox"
          aria-label="Code suggestions"
          className="max-h-72 overflow-y-auto p-1"
        >
          {items.map((item, index) => (
            <div
              id={`${id}-${index}`}
              key={`${item.label}-${index}`}
              role="option"
              aria-selected={index === selected}
              onMouseMove={() => onSelect(index)}
              onClick={() => onAccept(item)}
              className="aria-selected:bg-m3-surface-container-high flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2"
            >
              <span className="font-mono text-sm">{item.label}</span>
              {(item.detail ?? item.kind) && (
                <span className="text-muted-foreground ml-auto text-xs">
                  {item.detail ?? item.kind}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}

function SignatureHint({ signature }: { signature: SignatureHelp }) {
  const param = signature.params[signature.activeParameter]
  return (
    <div
      data-slot="signature-help"
      role="status"
      className="border-b px-3 py-2 text-sm"
    >
      <div className="font-mono wrap-break-word">
        {signature.label}(
        {signature.params.map((entry, index) => (
          <span key={entry.name}>
            {index > 0 && ', '}
            <span
              className={
                index === signature.activeParameter
                  ? 'font-bold underline'
                  : undefined
              }
            >
              {entry.name}
              {entry.optional ? '?' : ''}
            </span>
          </span>
        ))}
        )
      </div>
      {param?.description && (
        <div className="text-muted-foreground mt-1">{param.description}</div>
      )}
    </div>
  )
}
