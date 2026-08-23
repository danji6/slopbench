import {
  AlertMessage,
  ConfirmDialog,
  Dialog,
  ErrorBoundary,
  type FallbackProps,
  LoadingOverlay,
  RippleButton,
  type RippleButtonProps,
  SettingsFooter,
  SettingsTabs,
} from '@/components/ui'
import { useStableValue } from '@/hooks'
import {
  useAgentPromptSets,
  useAgentPromptSetsSave,
  useAgentUpdate,
  useEditingAgentId,
  useOwnedAgent,
  useSettings,
} from '@/hooks/chat'
import {
  AGENT_EDITOR_DEFAULT_TAB,
  AGENT_EDITOR_VIEW,
  useAgentEditorView,
  useOpenAgentEditor,
} from '@/hooks/chat/agent-editor'
import { useFormDraft } from '@/hooks/chat/form-draft'
import { useSettingsSave } from '@/hooks/chat/settings-save'
import { useHttpAction } from '@/hooks/http'
import { useScopedTheme } from '@/hooks/theme'
import { useViewCloseGuard } from '@/hooks/view'
import { setEditingAgentId } from '@/lib/chat/agent-editor-store'
import { type AvatarUploadResult, avatarUploadForm } from '@/lib/chat/avatar'
import { agentSettingsDraftKey } from '@/lib/chat/editor-draft-store'
import { extractErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { ThemeScope } from '@/providers/theme-scope'
import { api } from '@sb/convex/_generated/api'
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
import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'

import {
  type AgentFormValues,
  EMPTY_AGENT_FORM,
  EMPTY_AGENT_PROMPT_SETS,
  agentToFormValues,
  formValuesToPatch,
  splitAgentForm,
} from './agent-form'
import { AgentPicker } from './agent-picker'
import { AppearanceSettings } from './appearance-settings'
import { BehaviorSettings } from './behavior-settings'
import { ContextSettings } from './context-settings'
import { ModelSettings } from './model-settings'
import { ProfileSettings } from './profile-settings'
import { SubagentSettings } from './subagent-settings'
import { ToolSettings } from './tool-settings'

export function AgentSettings() {
  const agentId = useEditingAgentId()

  return (
    <ErrorBoundary
      resetKeys={[agentId]}
      fallback={(props) => <AgentSettingsFallback {...props} />}
    >
      <AgentSettingsDialog />
    </ErrorBoundary>
  )
}

function AgentSettingsFallback({ error }: FallbackProps) {
  const view = useAgentEditorView()

  return (
    <Dialog open={view.active} onOpenChange={(next) => !next && view.close()}>
      <Dialog.Content className="max-w-md">
        <Dialog.Header>
          <Dialog.Title>Agents</Dialog.Title>
          <Dialog.Description>
            This agent&apos;s settings could not be loaded.
          </Dialog.Description>
        </Dialog.Header>
        <AlertMessage dismissible={false}>
          {extractErrorMessage(error)}
        </AlertMessage>
        <Dialog.Footer>
          <RippleButton
            variant="secondary"
            onClick={() => setEditingAgentId(null)}
          >
            Choose another agent
          </RippleButton>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  )
}

function AgentSettingsDialog() {
  const view = useAgentEditorView()
  const open = view.active
  const activeTab = view.value ?? AGENT_EDITOR_DEFAULT_TAB
  // The id leads the local state while the document is fetched
  const agentId = useEditingAgentId()
  const liveAgent = useOwnedAgent(agentId)

  const updateAgent = useAgentUpdate()
  const promptSets = useAgentPromptSets(agentId ?? undefined)
  const savePromptSets = useAgentPromptSetsSave()
  const clearAvatar = useMutation(api.agents.clearAvatar)
  const uploadAvatar = useHttpAction<FormData, AvatarUploadResult>('/io/avatar/upload') // prettier-ignore

  const form = useForm<AgentFormValues>({ defaultValues: EMPTY_AGENT_FORM })

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

  // Keep the previous while loading to avoid empty flashing
  const loading =
    !!agentId && (liveAgent === undefined || promptSets === undefined)
  const editingAgent = useStableValue(liveAgent, loading)

  useEffect(() => {
    if (!open || loading) return
    draft.sync(
      editingAgent
        ? agentToFormValues(editingAgent, promptSets ?? EMPTY_AGENT_PROMPT_SETS)
        : EMPTY_AGENT_FORM,
    )
    // Sync from the live doc on agent switch or when (re)opening the editor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, open, loading])

  // The theme is previewed inside the dialog, while its tab is open
  const settings = useSettings()
  const globalThemeColor = settings?.theme?.source ?? null
  const previewThemeColor = useWatch({
    control: form.control,
    name: 'themeColor',
  })
  const previewing = open && activeTab === 'appearance'
  const themeScope = useScopedTheme(
    previewing ? previewThemeColor || globalThemeColor : null,
  )

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
    if (!agentId || loading) return

    if (pendingAvatar) {
      await uploadAvatar.call(avatarUploadForm(agentId, pendingAvatar))
      setPendingAvatar(null)
    } else if (avatarCleared) {
      await clearAvatar({ agentId })
      setAvatarCleared(false)
    }
    const { doc, sets } = splitAgentForm(values)
    await updateAgent(await formValuesToPatch(agentId, doc))
    await savePromptSets(agentId, sets)

    form.reset(values)
    draft.clear()
  }

  // Apply persists but keeps the editor open; Save persists then closes.
  const { saving, apply, save } = useSettingsSave(form, persist, close)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && !saving && guard(close)}
    >
      <ThemeScope className={themeScope}>
        <Dialog.Content
          showCloseButton={false}
          className={cn(
            'flex h-[min(95svh,900px)] max-w-3xl flex-col gap-0 p-0',
            themeScope,
          )}
        >
          <LoadingOverlay show={saving} className="rounded-lg" />

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

          {!editingAgent && !loading && (
            <p className="text-muted-foreground mt-8 px-4 text-center text-sm">
              Select or create an agent to edit its settings.
            </p>
          )}

          {editingAgent && (
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
                  <SettingsTabs.Trigger
                    value="behavior"
                    icon={<ActivityIcon />}
                  >
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
                  <SettingsTabs.Trigger
                    value="subagents"
                    icon={<NetworkIcon />}
                  >
                    Sub-agents
                  </SettingsTabs.Trigger>
                  <SettingsTabs.Trigger
                    value="appearance"
                    icon={<PaletteIcon />}
                  >
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
                busy={saving}
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
      </ThemeScope>

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
          'focus-visible:border-ring h-11 w-full justify-center font-bold focus-visible:border focus-visible:ring-0',
      )}
    >
      <BotIcon />
      {!collapsed && <span>Agents</span>}
    </RippleButton>
  )
}
