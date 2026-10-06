import {
  DropdownMenu,
  RippleButton,
  type RippleButtonProps,
} from '@/components/ui'
import { useSessionShowHidden } from '@/hooks/chat'
import { readSessionArchive } from '@/lib/chat/io'
import { toast, toastError } from '@/lib/notifications'
import { api } from '@sb/convex/_generated/api'
import { useAction } from 'convex/react'
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  EyeIcon,
  MoreHorizontalIcon,
  UploadIcon,
} from 'lucide-react'
import { useRef } from 'react'
import { useLocation } from 'wouter'

type SessionListMenuProps = RippleButtonProps & {
  onCollapseAll: () => void
  onExpandAll: () => void
}

export function SessionListMenu({
  onCollapseAll,
  onExpandAll,
  ...props
}: SessionListMenuProps) {
  const [, navigate] = useLocation()
  const importSession = useAction(api.actions.sessions.importOne)
  const { showHidden, setShowHidden } = useSessionShowHidden()
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const payload = await readSessionArchive(file)
      const { sessionId } = await importSession({ payload })
      navigate(`/?id=${sessionId}`, { replace: true })
      toast('Session imported')
    } catch (err) {
      toastError(err, 'Could not import session')
    } finally {
      e.target.value = ''
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenu.Trigger
          render={
            <RippleButton
              size="icon"
              variant="stealth"
              aria-label="Session list options"
              {...props}
            >
              <MoreHorizontalIcon />
            </RippleButton>
          }
        />
        <DropdownMenu.Content align="end" className="min-w-48">
          <DropdownMenu.Item onClick={() => fileInputRef.current?.click()}>
            <UploadIcon className="mr-2 size-4" />
            <span>Import</span>
          </DropdownMenu.Item>
          <DropdownMenu.CheckboxItem
            checked={showHidden}
            onCheckedChange={setShowHidden}
            closeOnClick={false}
          >
            <EyeIcon className="mr-2 size-4" />
            <span>Show hidden</span>
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.Item onClick={onCollapseAll}>
            <ChevronsDownUpIcon className="mr-2 size-4" />
            <span>Collapse all</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item onClick={onExpandAll}>
            <ChevronsUpDownIcon className="mr-2 size-4" />
            <span>Expand all</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileChange}
      />
    </>
  )
}
