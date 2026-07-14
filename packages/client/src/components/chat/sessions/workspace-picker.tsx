import { DropdownMenu, RippleButton } from '@/components/ui'
import { useRecentWorkspaces, useTools } from '@/hooks/chat'
import { collapsePath } from "@/lib/utils"
import { cn } from '@/lib/utils'
import { FolderIcon, HistoryIcon, Trash2Icon, XIcon } from 'lucide-react'
import { useState } from 'react'

import { WorkspacePickerDialog } from './workspace-picker-dialog'

interface ChatWorkspacePickerProps {
  value: string | null
  onChange: (root: string | null) => void
  className?: string
}

export function ChatWorkspacePicker({
  value,
  onChange,
  className,
}: ChatWorkspacePickerProps) {
  const { tools } = useTools()
  const { recent, remember, clear } = useRecentWorkspaces()
  const [open, setOpen] = useState(false)

  const canUseWorkspace = tools.some(
    (tool) => 'requiresWorkspace' in tool && tool.requiresWorkspace,
  )
  if (!canUseWorkspace) return null

  function pick(root: string) {
    onChange(root)
    remember(root)
  }

  return (
    <>
      <div
        className={cn(
          'bg-background/80 flex items-center gap-1 rounded-full p-1 backdrop-blur-md',
          className,
        )}
      >
        <RippleButton
          variant="stealth"
          className="text-muted-foreground h-9 max-w-full gap-1.5"
          title={value ?? undefined}
          onClick={() => setOpen(true)}
        >
          <FolderIcon className="mr-1 shrink-0" />
          <span className="truncate text-xs">
            {value ? collapsePath(value) : 'Select workspace'}
          </span>
        </RippleButton>

        {value && (
          <RippleButton
            variant="stealth"
            size="icon"
            aria-label="Clear workspace"
            className="text-muted-foreground size-9"
            onClick={() => onChange(null)}
          >
            <XIcon />
          </RippleButton>
        )}

        {recent.length > 0 && (
          <DropdownMenu>
            <DropdownMenu.Trigger
              render={
                <RippleButton
                  variant="stealth"
                  size="icon"
                  aria-label="Recent workspaces"
                  className="text-muted-foreground size-9"
                >
                  <HistoryIcon />
                </RippleButton>
              }
            />
            <DropdownMenu.Content
              align="start"
              className="w-[calc(min(fit-content,100%,200px))]"
            >
              <DropdownMenu.Group>
                <DropdownMenu.Label>Recent workspaces</DropdownMenu.Label>
                {recent.map((root) => (
                  <DropdownMenu.Item
                    key={root}
                    title={root}
                    onClick={() => pick(root)}
                  >
                    <FolderIcon />
                    <span className="truncate text-xs">
                      {collapsePath(root)}
                    </span>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Group>
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                onClick={() => clear()}
                className="text-muted-foreground text-xs"
              >
                <Trash2Icon />
                Clear recent workspaces
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu>
        )}
      </div>
      <WorkspacePickerDialog
        open={open}
        onOpenChange={setOpen}
        initialPath={value ?? recent[0] ?? undefined}
        onSelect={pick}
      />
    </>
  )
}
