import { useToolApprovalPicker } from '@/hooks/chat/tool-approval'
import { summarizeInput } from '@/lib/chat/tool-approval-policy'
import { HOLD_HINTS } from '@/lib/chat/tool-approval-policy'
import { cn } from '@/lib/utils'
import { type api } from '@sb/convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import { type RefObject, Suspense, lazy } from 'react'

import { Code, T } from '../../ui'
import { Command } from '../../ui/command'

const ComposerEditor = lazy(() =>
  import('../composer/composer-editor').then((module) => ({
    default: module.ComposerEditor,
  })),
)

export type SubagentApproval = FunctionReturnType<
  typeof api.subagents.pendingApprovals
>[number]

export function ToolApprovalPicker({
  className,
  restoreFocusRef,
  onAbort,
  childApproval,
}: ToolApprovalPickerProps) {
  const {
    visible,
    part,
    rootRef,
    planApproval,
    toolName,
    description,
    hold,
    actions,
    selectedAction,
    setSelectedAction,
    selectAction,
    handleNoteReady,
  } = useToolApprovalPicker({ restoreFocusRef, onAbort, childApproval })

  if (!visible || !part) return null

  return (
    <div
      data-slot="tool-approval-picker"
      ref={rootRef}
      tabIndex={-1}
      className={cn(
        'bg-m3-surface-container-low w-full overflow-hidden rounded-xl border shadow-lg outline-none',
        className,
      )}
    >
      <div className="space-y-2 p-3">
        {childApproval && (
          <div className="text-muted-foreground text-xs">
            Sub-agent:{' '}
            <span className="text-foreground font-medium">
              {childApproval.agentName}
            </span>
            {childApproval.title && ` · ${childApproval.title}`}
          </div>
        )}
        {planApproval ? (
          <div className="text-foreground text-sm font-medium">
            {planApproval.heading}
          </div>
        ) : (
          <div className="text-sm">
            <span className="text-muted-foreground ml-1">Approve:</span>{' '}
            <span className="text-foreground font-medium">
              {part.title || toolName}
            </span>
          </div>
        )}
        {!planApproval && (
          <>
            <Code
              text={summarizeInput(part.input)}
              language={toolName === 'shell' ? 'shell' : undefined}
              className="mx-auto w-full"
              innerClassName="max-h-40 border-0 py-0"
              noLoadingIndicator
              wordWrap
            />
            {description && (
              <div className="text-muted-foreground -mt-2 ml-6 text-xs">
                {description}
              </div>
            )}
          </>
        )}
        <T.hr className="mx-auto w-[calc(100%-(var(--spacing)*2.5))]" />
        {hold && (
          <div className="text-muted-foreground ml-2 text-xs">
            {HOLD_HINTS[hold]}
          </div>
        )}
        <Command
          shouldFilter={false}
          value={selectedAction}
          onValueChange={setSelectedAction}
        >
          <Command.CommandList>
            {actions.map((action) => (
              <Command.CommandItem
                key={action.id}
                value={action.id}
                onSelect={() => selectAction(action)}
                className="flex items-center gap-2 rounded-lg px-3 py-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium whitespace-nowrap">
                  {action.label}
                </span>
                <kbd
                  data-slot="command-shortcut"
                  className="text-muted-foreground bg-muted ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] uppercase"
                >
                  {action.shortcut}
                </kbd>
              </Command.CommandItem>
            ))}
          </Command.CommandList>
        </Command>
        <div
          data-slot="approval-note"
          className="bg-background/60 max-h-32 overflow-y-auto rounded-lg border px-3 py-1.5"
          style={{
            fontFamily: 'var(--chat-font-family)',
            fontSize: 'var(--chat-font-size)',
          }}
        >
          <Suspense fallback={<div aria-hidden className="h-8" />}>
            <ComposerEditor
              placeholder="Add a note (optional)…"
              autoFocus={false}
              editorClassName="min-h-8! [&_p]:mt-0!"
              onReady={handleNoteReady}
            />
          </Suspense>
        </div>
      </div>
    </div>
  )
}

export type ToolApprovalPickerProps = {
  className?: string
  restoreFocusRef?: RefObject<{ focus(options?: FocusOptions): void } | null>
  onAbort?: () => void
  childApproval?: SubagentApproval
}
