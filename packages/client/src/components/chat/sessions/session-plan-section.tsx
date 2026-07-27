import { MarkdownRenderer } from '@/components/markdown/renderer'
import {
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
import { Suspense, lazy, useEffect, useRef } from 'react'

import type { PlanEditorHandle, PlanSnapshot } from './plan-editor'

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
            <RippleButton variant="input" size="sm" onClick={() => view.open()}>
              <EyeIcon />
              Inspect
            </RippleButton>
            <ConfirmDialog
              variant="destructive"
              title="Delete the plan?"
              description="The agent will no longer see it in new messages."
              confirmText="Delete"
              onConfirm={() => void handleDelete()}
            >
              <RippleButton variant="input" size="sm">
                <Trash2Icon />
                Delete
              </RippleButton>
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

/** Drafts written before the document was kept beside the markdown. */
type StoredPlanDraft = PlanSnapshot | string

function asSnapshot(
  stored: StoredPlanDraft,
): { markdown: string } & Partial<PlanSnapshot> {
  return typeof stored === 'string' ? { markdown: stored } : stored
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
  const draft = useEditorDraft<StoredPlanDraft>(
    planDraftKey(sessionId),
    'this plan',
  )

  const editor = useRef<PlanEditorHandle>(null)
  const markdown = useRef(content)
  // What the editor holds while it still differs from the saved plan
  const unsaved = useRef<StoredPlanDraft | null>(null)
  // The saved plan as the editor writes it back
  const baseline = useRef<string | null>(null)

  // Records what the editor holds, keeping the draft in step with it
  function track(snapshot: PlanSnapshot) {
    markdown.current = snapshot.markdown
    const saved = snapshot.markdown === (baseline.current ?? content)
    unsaved.current = saved ? null : snapshot
    if (saved) draft.clearUnchanged()
    else draft.save(snapshot)
  }

  // Editing resumes where it left off
  useEffect(() => {
    draft.restore((stored) => {
      const saved = asSnapshot(stored)
      markdown.current = saved.markdown
      unsaved.current = stored
      // Written into the editor, which reports it back through `track`
      editor.current?.write(saved.doc ?? saved.markdown)
    })
    // Asked once when the editor mounts
  }, [draft])

  // Editing ends by unmounting, which would drop a pending autosave
  useEffect(() => {
    return () => {
      if (unsaved.current !== null) draft.flush(unsaved.current)
    }
  }, [draft])

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
      ref={editor}
      initialContent={content}
      fullscreenId={PLAN_FULLSCREEN_ID}
      onChange={track}
      onBaseline={(markdown) => {
        baseline.current ??= markdown
      }}
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
            // Above the fullscreen editor this is confirmed from
            layer={55}
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
