import { type IconName, IconSvg } from '@/components/icon-picker'
import { Command, Popover, Surface } from '@/components/ui'
import { useFlexWrapped } from '@/hooks'
import { useScripts } from '@/hooks/chat/scripts'
import type { TextScript } from '@/hooks/chat/scripts'
import { cn } from '@/lib/utils'
import type { Editor } from '@tiptap/react'
import {
  BoldIcon,
  DeleteIcon,
  GanttChartIcon,
  ItalicIcon,
  QuoteIcon,
  RemoveFormattingIcon,
  Settings2Icon,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useLayoutEffect, useRef, useState } from 'react'
import React from 'react'

import { MenuButton } from './menu-button'

type DefaultAction = {
  id: string
  name: string
  icon: React.ReactNode
  editorAction?: (editor: Editor) => void
  code?: string
  separator?: boolean
}

const QUOTES = ['"', '“', '”']
const QUOTE_OPEN = '“'
const QUOTE_CLOSE = '”'

const DEFAULT_ACTIONS: DefaultAction[] = [
  {
    id: 'clear',
    name: 'Clear formatting',
    icon: <RemoveFormattingIcon />,
    editorAction: (editor) => editor.chain().focus().unsetAllMarks().run(),
  },
  {
    id: 'delete',
    name: 'Delete',
    icon: <DeleteIcon />,
    separator: true,
    editorAction: (editor) => editor.chain().focus().deleteSelection().run(),
  },
  {
    id: 'bold',
    name: 'Bold',
    icon: <BoldIcon />,
    editorAction: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    id: 'italics',
    name: 'Italics',
    icon: <ItalicIcon />,
    editorAction: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    id: 'quote',
    name: 'Quote',
    icon: <QuoteIcon />,
    editorAction: (editor) => {
      const { from, to } = editor.state.selection
      const text = editor.state.doc.textBetween(from, to)
      const isQuoted =
        text.length >= 2 &&
        QUOTES.includes(text[0]) &&
        QUOTES.includes(text[text.length - 1])
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          if (isQuoted) {
            tr.delete(to - 1, to)
            tr.delete(from, from + 1)
          } else {
            tr.insertText(QUOTE_CLOSE, to)
            tr.insertText(QUOTE_OPEN, from)
          }
          return true
        })
        .setTextSelection({ from, to: isQuoted ? to - 2 : to + 2 })
        .run()
    },
  },
]

export function ScriptToolbarContent({
  onScript,
  preventMouseDefault = false,
  onScriptsPopoverOpenChange,
  onManageScripts,
  onAction: onAction,
  actions: actions,
  popoverSide = 'top',
}: {
  onScript: (code: string) => void
  preventMouseDefault?: boolean
  onScriptsPopoverOpenChange?: (open: boolean) => void
  onManageScripts?: () => void
  onAction?: (action: (editor: Editor) => void) => void
  actions?: React.ReactNode[]
  popoverSide?: 'top' | 'bottom'
}) {
  const { scripts } = useScripts()
  const pinned = scripts.filter((s) => s.pinned)
  const unpinned = scripts.filter((s) => !s.pinned)

  const topRef = useRef<HTMLDivElement>(null)
  const [topWidth, setTopWidth] = useState<number>()
  // Match the bottom bar's witdth with the top one's
  useLayoutEffect(() => {
    const el = topRef.current
    if (!el) return
    const update = () => setTopWidth(el.offsetWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // The pinned bar wraps once its content can't fit within topWidth; use a
  // pill when it's a single row, a softer radius once it wraps.
  const [pinnedRef, wrapped] = useFlexWrapped<HTMLDivElement>()

  function actionProps(code: string) {
    return preventMouseDefault
      ? {
          onMouseUp: (e: React.MouseEvent) => {
            e.preventDefault()
            onScript(code)
          },
        }
      : { onClick: () => onScript(code) }
  }

  function editorActionProps(action: (editor: Editor) => void) {
    return preventMouseDefault
      ? {
          onMouseUp: (e: React.MouseEvent) => {
            e.preventDefault()
            onAction?.(action)
          },
        }
      : { onClick: () => onAction?.(action) }
  }

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.9 }}
      transition={{ ease: 'easeOut', duration: 0.15 }}
      className="flex flex-col items-start gap-1.5"
    >
      <div ref={topRef} className="flex">
        <Surface className="supports-backdrop-filter:bg-surface-container-low/80 flex items-center gap-0.5 rounded-full p-1.5 shadow-lg supports-backdrop-filter:backdrop-blur-lg">
          {DEFAULT_ACTIONS.map((action) => (
            <React.Fragment key={action.id}>
              <MenuButton
                tooltip={action.name}
                {...(action.editorAction
                  ? editorActionProps(action.editorAction)
                  : actionProps(action.code ?? ''))}
              >
                {action.icon}
              </MenuButton>
              {action.separator && <Separator />}
            </React.Fragment>
          ))}
          <Separator />
          {unpinned.length > 0 ? (
            <ScriptsPopover
              scripts={unpinned}
              onApply={onScript}
              onManage={onManageScripts}
              preventMouseDefault={preventMouseDefault}
              onOpenChange={onScriptsPopoverOpenChange}
              side={popoverSide}
            />
          ) : (
            <MenuButton tooltip="Scripts" onClick={onManageScripts}>
              <GanttChartIcon />
            </MenuButton>
          )}
          {actions && actions.length > 0 && <Separator />}
          {actions}
        </Surface>
      </div>
      {pinned.length > 0 && (
        <Surface
          ref={pinnedRef}
          style={{ width: 'fit-content', maxWidth: topWidth }}
          className={cn(
            'supports-backdrop-filter:bg-surface-container-low/80 flex max-h-40 flex-wrap items-center justify-center gap-0.5 overflow-y-auto overscroll-contain p-1.5 shadow-lg supports-backdrop-filter:backdrop-blur-lg',
            wrapped ? 'rounded-2xl' : 'rounded-full',
          )}
        >
          {pinned.map((script) => (
            <MenuButton
              key={script.id}
              tooltip={script.name}
              {...actionProps(script.code)}
            >
              <ScriptIcon script={script} />
            </MenuButton>
          ))}
        </Surface>
      )}
    </motion.div>
  )
}

function ScriptsPopover({
  scripts,
  onApply,
  onManage,
  onOpenChange,
  preventMouseDefault = false,
  side = 'top',
}: {
  scripts: TextScript[]
  onApply: (code: string) => void
  onManage?: () => void
  onOpenChange?: (open: boolean) => void
  preventMouseDefault?: boolean
  side?: 'top' | 'bottom'
}) {
  const [open, setOpen] = useState(false)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    onOpenChange?.(next)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger
        nativeButton
        render={<MenuButton tooltip="Scripts" />}
        className="flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-black/5 dark:hover:bg-white/10"
        onMouseDown={
          preventMouseDefault ? (e) => e.preventDefault() : undefined
        }
      >
        <GanttChartIcon />
      </Popover.Trigger>
      <Popover.Content className="w-56 p-0" align="start" side={side}>
        <Command>
          <div className="flex items-center gap-1 p-1 pb-0 **:data-[slot=command-input-wrapper]:flex-1 **:data-[slot=command-input-wrapper]:p-0">
            <Command.CommandInput placeholder="Search scripts..." />
            {onManage && (
              <MenuButton
                tooltip="Manage scripts"
                onMouseDown={
                  preventMouseDefault ? (e) => e.preventDefault() : undefined
                }
                onClick={() => {
                  handleOpenChange(false)
                  onManage()
                }}
              >
                <Settings2Icon />
              </MenuButton>
            )}
          </div>
          {scripts.length === 0 ? (
            <div className="text-muted-foreground py-6 text-center text-sm">
              Empty
            </div>
          ) : (
            <Command.CommandList>
              <Command.CommandEmpty>No scripts found.</Command.CommandEmpty>
              {scripts.map((script) => (
                <Command.CommandItem
                  key={script.id}
                  value={script.id}
                  keywords={[script.name]}
                  onSelect={() => {
                    onApply(script.code)
                    handleOpenChange(false)
                  }}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <ScriptIcon script={script} />
                    <span className="min-w-0 truncate">{script.name}</span>
                  </div>
                </Command.CommandItem>
              ))}
            </Command.CommandList>
          )}
        </Command>
      </Popover.Content>
    </Popover>
  )
}

export function ScriptIcon({ script }: { script: TextScript }) {
  if (script.icon) {
    return <IconSvg name={script.icon as IconName} />
  }
  const initials = script.name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join('')
  return (
    <span className="text-[10px] leading-none font-bold">
      {initials || '?'}
    </span>
  )
}

function Separator() {
  return <div className="bg-border mx-0.5 h-4 w-px" />
}
