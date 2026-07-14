import { MarkdownRenderer } from '@/components/markdown/renderer'
import {
  Button,
  ConfirmDialog,
  Dialog,
  RippleButton,
  SettingsList,
  Sidebar,
} from '@/components/ui'
import { useActiveSession, useMathMode } from '@/hooks/chat'
import { toast } from '@/lib/notifications'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useMutation, useQuery } from 'convex/react'
import { EyeIcon, Trash2Icon } from 'lucide-react'
import { Suspense, lazy, useRef, useState } from 'react'

const RichTextEditor = lazy(() =>
  import('../messages/editor/rich-text-editor').then((module) => ({
    default: module.RichTextEditor,
  })),
)

export function SessionPlanSection() {
  const session = useActiveSession()
  const plan = useQuery(
    api.plans.get,
    session ? { sessionId: session._id } : 'skip',
  )
  const removePlan = useMutation(api.plans.remove)
  const [open, setOpen] = useState(false)

  if (!session || !plan) return null

  async function handleDelete() {
    if (!session) return
    try {
      await removePlan({ sessionId: session._id })
      toast('Plan deleted')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Sidebar.Section label="Plan">
      <SettingsList>
        <SettingsList.Item
          orientation="vertical"
          unclickable
          unhoverable
          label="Session plan"
          description={plan.status === 'approved' ? 'Approved' : 'Drafting'}
        >
          <div className="flex flex-wrap gap-2">
            <Button variant="input" size="sm" onClick={() => setOpen(true)}>
              <EyeIcon />
              Inspect
            </Button>
            <ConfirmDialog
              variant="destructive"
              title="Delete the plan?"
              description="The agent will no longer see it in new messages."
              confirmText="Delete"
              onConfirm={() => void handleDelete()}
            >
              <Button variant="input" size="sm">
                <Trash2Icon />
                Delete
              </Button>
            </ConfirmDialog>
          </div>
        </SettingsList.Item>
      </SettingsList>
      <PlanDialog
        open={open}
        onOpenChange={setOpen}
        sessionId={session._id}
        content={plan.content}
      />
    </Sidebar.Section>
  )
}

function PlanDialog({
  open,
  onOpenChange,
  sessionId,
  content,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: Id<'sessions'>
  content: string
}) {
  const mathMode = useMathMode()
  const update = useMutation(api.plans.update)
  const [editing, setEditing] = useState(false)
  const draftRef = useRef(content)

  function startEditing() {
    draftRef.current = content
    setEditing(true)
  }

  async function saveDraft() {
    try {
      await update({ sessionId, content: draftRef.current })
      setEditing(false)
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err))
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) setEditing(false)
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Dialog.Content className="grid h-[calc(100svh-2rem)] max-h-180 max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
        <Dialog.Header>
          <Dialog.Title>Session plan</Dialog.Title>
        </Dialog.Header>
        <div className="bg-m3-surface-container-low min-h-0 overflow-y-auto rounded-lg p-4">
          {editing ? (
            <Suspense fallback={null}>
              <RichTextEditor
                initialMarkdown={content}
                onChange={(markdown) => (draftRef.current = markdown)}
                onSave={() => void saveDraft()}
                onCancel={() => setEditing(false)}
              />
            </Suspense>
          ) : (
            <MarkdownRenderer mathMode={mathMode}>{content}</MarkdownRenderer>
          )}
        </div>
        <Dialog.Footer>
          {editing ? (
            <>
              <RippleButton variant="input" onClick={() => setEditing(false)}>
                Cancel
              </RippleButton>
              <RippleButton onClick={() => void saveDraft()}>Save</RippleButton>
            </>
          ) : (
            <RippleButton variant="input" onClick={startEditing}>
              Edit
            </RippleButton>
          )}
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  )
}
