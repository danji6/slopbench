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
import { useFullscreenView } from '@/hooks/fullscreen'
import { useView } from '@/hooks/view'
import {
  clearEditorDraft,
  planDraftKey,
  useEditorDraft,
} from '@/lib/chat/editor-draft-store'
import { toast } from '@/lib/notifications'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useMutation, useQuery } from 'convex/react'
import { EyeIcon, Trash2Icon } from 'lucide-react'
import { Suspense, lazy, useEffect, useRef, useState } from 'react'

const PlanEditor = lazy(() =>
  import('./plan-editor').then((module) => ({ default: module.PlanEditor })),
)

/** `?view=` segment owned by the plan dialog, of which there is only one. */
const PLAN_VIEW = 'plan'

// Only one plan is inspected at a time, so a fixed id is enough to identify it
const PLAN_FULLSCREEN_ID = 'plan'

export function SessionPlanSection() {
  const session = useActiveSession()
  const plan = useQuery(
    api.plans.get,
    session ? { sessionId: session._id } : 'skip',
  )
  const removePlan = useMutation(api.plans.remove)
  const view = useView(PLAN_VIEW)

  if (!session || !plan) return null

  async function handleDelete() {
    if (!session) return
    try {
      await removePlan({ sessionId: session._id })
      clearEditorDraft(planDraftKey(session._id))
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
            <Button variant="input" size="sm" onClick={() => view.open()}>
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
        open={view.active}
        onClose={view.close}
        sessionId={session._id}
        content={plan.content}
      />
    </Sidebar.Section>
  )
}

function PlanDialog({
  open,
  onClose,
  sessionId,
  content,
}: {
  open: boolean
  onClose: () => void
  sessionId: Id<'sessions'>
  content: string
}) {
  const mathMode = useMathMode()
  const fullscreen = useFullscreenView(PLAN_FULLSCREEN_ID)
  // Always fullscreen while editing a plan
  const editing = fullscreen.active

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Content className="grid h-[calc(100svh-2rem)] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-hidden pb-4">
        <Dialog.Header>
          <Dialog.Title>Session plan</Dialog.Title>
        </Dialog.Header>
        {editing ? (
          <Suspense fallback={null}>
            <PlanDraftEditor
              sessionId={sessionId}
              content={content}
              onDone={fullscreen.exit}
            />
          </Suspense>
        ) : (
          <div className="bg-m3-surface-container-low min-h-0 overflow-y-auto rounded-lg p-4">
            <MarkdownRenderer mathMode={mathMode}>{content}</MarkdownRenderer>
          </div>
        )}
        <Dialog.Footer>
          <RippleButton
            variant="input"
            onClick={fullscreen.enter}
            className="w-25 max-w-full"
          >
            Edit
          </RippleButton>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  )
}

/** The plan editor, backed by a draft that outlives the dialog and the page. */
function PlanDraftEditor({
  sessionId,
  content,
  onDone,
}: {
  sessionId: Id<'sessions'>
  content: string
  onDone: () => void
}) {
  const update = useMutation(api.plans.update)
  const draft = useEditorDraft<string>(planDraftKey(sessionId))

  // Editing resumes where it left off, whether that was this tab or a past one
  const [initialMarkdown] = useState(() => draft.read() ?? content)
  const markdown = useRef(initialMarkdown)
  // Markdown that still differs from the saved plan, null once it matches
  const unsaved = useRef(initialMarkdown === content ? null : initialMarkdown)

  // Editing ends by unmounting, which would drop a pending autosave
  useEffect(() => {
    return () => {
      if (unsaved.current !== null) draft.flush(unsaved.current)
    }
  }, [draft])

  function handleChange(next: string) {
    markdown.current = next
    unsaved.current = next === content ? null : next
    if (unsaved.current === null) draft.clear()
    else draft.save(next)
  }

  function stopEditing() {
    unsaved.current = null
    draft.clear()
    onDone()
  }

  async function save() {
    try {
      await update({ sessionId, content: markdown.current })
      stopEditing()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <PlanEditor
      initialMarkdown={initialMarkdown}
      fullscreenId={PLAN_FULLSCREEN_ID}
      onChange={handleChange}
      onSave={() => void save()}
      toolbar={
        <>
          <ConfirmDialog
            variant="destructive"
            title="Stop editing?"
            description="Any unsaved changes to the plan will be lost."
            confirmText="Discard"
            cancelText="Keep editing"
            onConfirm={stopEditing}
            className="z-55"
          >
            <RippleButton variant="input" size="sm">
              Discard
            </RippleButton>
          </ConfirmDialog>
          <RippleButton size="sm" onClick={() => void save()} className="w-20">
            Save
          </RippleButton>
        </>
      }
    />
  )
}
