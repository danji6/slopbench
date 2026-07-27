import {
  ConfirmDialog,
  Dialog,
  RippleButton,
  type RippleButtonProps,
  SettingsFooter,
  SettingsTabs,
} from '@/components/ui'
import { useAgentUpdate, useEditingAgent, useSettings } from '@/hooks/chat'
import {
  AGENT_EDITOR_DEFAULT_TAB,
  AGENT_EDITOR_VIEW,
  useAgentEditorView,
  useOpenAgentEditor,
} from '@/hooks/chat/agent-editor'
import { useFormDraft } from '@/hooks/chat/form-draft'
import { useHttpAction } from '@/hooks/http'
import { setThemePreview } from '@/hooks/theme'
import { useViewCloseGuard } from '@/hooks/view'
import { type AvatarUploadResult, avatarUploadForm } from '@/lib/chat/avatar'
import { agentSettingsDraftKey } from '@/lib/chat/editor-draft-store'
import { cn } from '@/lib/utils'
import { api } from '@sb/convex/_generated/api'
import { ensurePromptMarkers } from '@sb/convex/model/prompt/markers'
import { useMutation } from 'convex/react'
import {
  ActivityIcon,
  BotIcon,
  LayersIcon,
  NetworkIcon,
  PaletteIcon,
  UserIcon,
  WrenchIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'

import {
  AGENT_PROMPT_MARKERS,
  type AgentFormValues,
  agentToFormValues,
  formValuesToPatch,
} from './agent-form'
import { AgentPicker } from './agent-picker'
import { AppearanceSettings } from './appearance-settings'
import { BehaviorSettings } from './behavior-settings'
import { ContextSettings } from './context-settings'
import { ModelSettings } from './model-settings'
import { ProfileSettings } from './profile-settings'
import { SubagentSettings } from './subagent-settings'
import { ToolSettings } from './tool-settings'

const EMPTY_FORM: AgentFormValues = {
  name: '',
  description: '',
  prompts: ensurePromptMarkers([], AGENT_PROMPT_MARKERS),
  promptOrder: undefined,
  globalPromptsEnabled: true,
  reminderPrompts: [],
  libraryReminderIds: [],
  modelId: null,
  reasoningEffort: null,
  tools: [],
  autoApproveTools: [],
  autoApproveShell: [],
  subAgentsMode: 'allow',
  subAgentIds: [],
  trimContext: false,
  contextWindow: -1,
  outputTokens: -1,
  customCss: '',
  themeColor: '',
}

export function AgentSettings() {
  const view = useAgentEditorView()
  const open = view.active
  const activeTab = view.value ?? AGENT_EDITOR_DEFAULT_TAB
  const editingAgent = useEditingAgent()
  const agentId = editingAgent?._id

  const updateAgent = useAgentUpdate()
  const clearAvatar = useMutation(api.agents.clearAvatar)
  const uploadAvatar = useHttpAction<FormData, AvatarUploadResult>(
    '/io/avatar/upload',
  )

  const form = useForm<AgentFormValues>({ defaultValues: EMPTY_FORM })

  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null)
  const [avatarCleared, setAvatarCleared] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)

  const [prevAgentId, setPrevAgentId] = useState(agentId)
  if (agentId !== prevAgentId) {
    setPrevAgentId(agentId)
    setPendingAvatar(null)
    setAvatarCleared(false)
  }

  const draft = useFormDraft(
    agentId ? agentSettingsDraftKey(agentId) : undefined,
    form,
    'these agent settings',
  )

  useEffect(() => {
    if (!open) return
    form.reset(editingAgent ? agentToFormValues(editingAgent) : EMPTY_FORM)
    if (editingAgent) draft.restore()
    // Sync from the live doc on agent switch or when (re)opening the editor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, open])

  // Live preview theme
  const settings = useSettings()
  const globalThemeColor = settings?.theme?.source ?? null
  const themePreviewActive = useRef(false)
  const clearThemePreview = useCallback(() => {
    if (!themePreviewActive.current) return
    themePreviewActive.current = false
    setThemePreview(null)
  }, [])
  const previewThemeColor = useWatch({
    control: form.control,
    name: 'themeColor',
  })
  useEffect(() => {
    if (!open) return
    themePreviewActive.current = true
    setThemePreview({ themeColor: previewThemeColor || globalThemeColor })
  }, [open, previewThemeColor, globalThemeColor])
  useEffect(() => clearThemePreview, [clearThemePreview])

  const isDirty =
    form.formState.isDirty || pendingAvatar !== null || avatarCleared

  function close() {
    view.close()
  }

  function discard() {
    form.reset()
    draft.clear()
    setPendingAvatar(null)
    setAvatarCleared(false)
  }

  // Back must not silently drop unsaved agent settings
  const closeGuard = useViewCloseGuard(AGENT_EDITOR_VIEW, {
    isDirty,
    onDiscard: discard,
  })

  function guard(action: () => void) {
    if (!isDirty) return action()
    setPendingAction(() => action)
  }

  function confirmPending() {
    const action = pendingAction
    setPendingAction(null)
    discard()
    action?.()
  }

  function handleStageAvatar(file: File | null) {
    setPendingAvatar(file)
    if (file) setAvatarCleared(false)
  }

  async function persist(values: AgentFormValues) {
    if (!agentId) return
    if (pendingAvatar) {
      await uploadAvatar.call(avatarUploadForm(agentId, pendingAvatar))
      setPendingAvatar(null)
    } else if (avatarCleared) {
      await clearAvatar({ agentId })
      setAvatarCleared(false)
    }
    await updateAgent(await formValuesToPatch(agentId, values))
    form.reset(values)
    draft.clear()
  }

  // Apply persists but keeps the editor open; Save persists then closes.
  const apply = form.handleSubmit(persist)
  const save = form.handleSubmit(async (values) => {
    await persist(values)
    close()
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && guard(close)}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) clearThemePreview()
      }}
    >
      <Dialog.Content
        showCloseButton={false}
        className="flex h-[min(95svh,900px)] max-w-3xl flex-col gap-0 p-0"
      >
        <Dialog.Header className="flex flex-col justify-between border-b px-6 py-4 text-left sm:flex-row sm:items-center">
          <div className="flex flex-col gap-2 text-left">
            <Dialog.Title>Agents</Dialog.Title>
            <Dialog.Description className="text-muted-foreground">
              Manage your agents.
            </Dialog.Description>
          </div>
          <AgentPicker
            className="mt-2 w-fit max-w-full min-w-80"
            confirmSwitch={guard}
          />
        </Dialog.Header>

        {!editingAgent ? (
          <p className="text-muted-foreground mt-8 px-4 text-center text-sm">
            Select or create an agent to edit its settings.
          </p>
        ) : (
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={apply}>
            <SettingsTabs
              value={activeTab}
              onValueChange={(tab: string) => view.setValue(tab)}
              className="min-h-0 flex-1"
            >
              <SettingsTabs.List className="border-border">
                <SettingsTabs.Trigger value="profile" icon={<UserIcon />}>
                  Profile
                </SettingsTabs.Trigger>
                <SettingsTabs.Trigger value="behavior" icon={<ActivityIcon />}>
                  Behavior
                </SettingsTabs.Trigger>
                <SettingsTabs.Trigger value="context" icon={<LayersIcon />}>
                  Context
                </SettingsTabs.Trigger>
                <SettingsTabs.Trigger value="model" icon={<BotIcon />}>
                  Model
                </SettingsTabs.Trigger>
                <SettingsTabs.Trigger value="tools" icon={<WrenchIcon />}>
                  Tools
                </SettingsTabs.Trigger>
                <SettingsTabs.Trigger value="subagents" icon={<NetworkIcon />}>
                  Sub-agents
                </SettingsTabs.Trigger>
                <SettingsTabs.Trigger value="appearance" icon={<PaletteIcon />}>
                  Appearance
                </SettingsTabs.Trigger>
              </SettingsTabs.List>

              <SettingsTabs.Content value="profile" title="Profile">
                <ProfileSettings
                  control={form.control}
                  avatarId={editingAgent.avatarId}
                  pendingAvatar={pendingAvatar}
                  avatarCleared={avatarCleared}
                  onStageAvatar={handleStageAvatar}
                  onClearAvatar={() => setAvatarCleared(true)}
                />
              </SettingsTabs.Content>
              <SettingsTabs.Content value="model" title="Model">
                <ModelSettings control={form.control} />
              </SettingsTabs.Content>
              <SettingsTabs.Content value="context" title="Context">
                <ContextSettings control={form.control} />
              </SettingsTabs.Content>
              <SettingsTabs.Content value="tools" title="Tools">
                <ToolSettings control={form.control} />
              </SettingsTabs.Content>
              <SettingsTabs.Content value="subagents" title="Sub-agents">
                <SubagentSettings control={form.control} />
              </SettingsTabs.Content>
              <SettingsTabs.Content value="behavior" title="Behavior">
                <BehaviorSettings control={form.control} />
              </SettingsTabs.Content>
              <SettingsTabs.Content value="appearance" title="Appearance">
                <AppearanceSettings control={form.control} />
              </SettingsTabs.Content>
            </SettingsTabs>

            <SettingsFooter
              isDirty={isDirty}
              onClose={close}
              onDiscard={() => {
                discard()
                close()
              }}
              onSave={save}
            />
          </form>
        )}
      </Dialog.Content>

      <ConfirmDialog
        open={pendingAction !== null || closeGuard.pending}
        onOpenChange={(o) => {
          if (o) return
          setPendingAction(null)
          closeGuard.cancel()
        }}
        variant="destructive"
        title="Discard changes?"
        description="Your unsaved changes will be lost."
        confirmText="Discard"
        cancelText="Keep editing"
        onConfirm={closeGuard.pending ? closeGuard.confirm : confirmPending}
      />
    </Dialog>
  )
}

export function ManageAgentsButton({
  collapsed = false,
  onClick,
  ...props
}: RippleButtonProps & {
  collapsed?: boolean
}) {
  const openAgentEditor = useOpenAgentEditor()

  return (
    <RippleButton
      {...props}
      variant="stealth"
      size={!collapsed ? 'default' : 'icon'}
      onClick={(e) => {
        onClick?.(e)
        openAgentEditor()
      }}
      aria-label="Manage agents"
      className={cn(
        'text-muted-foreground rounded-full',
        !collapsed &&
          'focus-visible:border-ring h-11 w-full justify-center rounded-md font-bold focus-visible:border focus-visible:ring-0',
      )}
    >
      <BotIcon />
      {!collapsed && <span>Agents</span>}
    </RippleButton>
  )
}
