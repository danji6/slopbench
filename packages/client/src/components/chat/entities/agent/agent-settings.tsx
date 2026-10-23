import { IntegrationSelection } from '@/components/chat/integrations/integration-selection'
import { AgentFiles } from '@/components/chat/skills/agent-files'
import { AgentSkills } from '@/components/chat/skills/agent-skills'
import {
  AlertMessage,
  ConfirmDialog,
  Dialog,
  ErrorBoundary,
  type FallbackProps,
  LoadingOverlay,
  RippleButton,
  type RippleButtonProps,
  SettingsDialogTitle,
  SettingsFooter,
  SettingsSwitchButton,
  SettingsTabs,
} from '@/components/ui'
import { useStableValue } from '@/hooks'
import {
  useAgentPromptSets,
  useEditingAgentId,
  useNewAgent,
  useOwnedAgent,
  useSettings,
} from '@/hooks/chat'
import {
  AGENT_EDITOR_DEFAULT_TAB,
  AGENT_EDITOR_VIEW,
  useAgentEditorView,
  useOpenAgentEditor,
} from '@/hooks/chat/agent-editor'
import { useAgentSettingsPersistence } from '@/hooks/chat/agent-settings-save'
import { useFormDraft } from '@/hooks/chat/form-draft'
import { useSettingsSave } from '@/hooks/chat/settings-save'
import { useScopedTheme } from '@/hooks/theme'
import { useViewCloseGuard } from '@/hooks/view'
import {
  getCreatedAgentId,
  setEditingAgentId,
} from '@/lib/chat/agent-editor-store'
import {
  NEW_AGENT_DRAFT_KEY,
  agentSettingsDraftKey,
  getEditorDraft,
  setEditorDraft,
} from '@/lib/chat/editor-draft-store'
import { extractErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { ThemeScope } from '@/providers/theme-scope'
import {
  ActivityIcon,
  BlocksIcon,
  BookOpenIcon,
  BotIcon,
  NetworkIcon,
  PaletteIcon,
  UserIcon,
  WrenchIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'

import {
  type AgentFormValues,
  EMPTY_AGENT_FORM,
  EMPTY_AGENT_PROMPT_SETS,
  agentToFormValues,
  newAgentFormValues,
} from './agent-form'
import { AgentPicker } from './agent-picker'
import { AppearanceSettings } from './appearance-settings'
import { BehaviorGeneralSettings } from './behavior-settings'
import { ContextSettings } from './context-settings'
import { ProfileSettings } from './profile-settings'
import { SubagentSettings } from './subagent-settings'
import { ToolSettings } from './tool-settings'

const AGENT_SETTINGS_TABS = [
  { value: 'profile', label: 'Profile', icon: UserIcon },
  { value: 'behavior', label: 'Behavior', icon: ActivityIcon },
  { value: 'skills', label: 'Skills', icon: BookOpenIcon },
  { value: 'integrations', label: 'Integrations', icon: BlocksIcon },
  { value: 'tools', label: 'Tools', icon: WrenchIcon },
  { value: 'subagents', label: 'Sub-agents', icon: NetworkIcon },
  { value: 'appearance', label: 'Appearance', icon: PaletteIcon },
]

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

type PendingAction = {
  proceed: () => void
  canSave: boolean
  open: boolean
}

function AgentSettingsDialog() {
  const toolsScrollRef = useRef<HTMLDivElement>(null)
  const view = useAgentEditorView()
  const open = view.active
  const requestedTab = view.value ?? AGENT_EDITOR_DEFAULT_TAB
  const activeTab = ['files', 'context'].includes(requestedTab)
    ? 'behavior'
    : requestedTab
  const activeTabLabel = AGENT_SETTINGS_TABS.find(
    (tab) => tab.value === activeTab,
  )?.label
  // The id leads the local state while the document is fetched
  const agentId = useEditingAgentId()
  const liveAgent = useOwnedAgent(agentId)
  const newAgent = useNewAgent()
  const editorKey = newAgent ? NEW_AGENT_DRAFT_KEY : agentId

  const promptSets = useAgentPromptSets(agentId ?? undefined)

  const form = useForm<AgentFormValues>({ defaultValues: EMPTY_AGENT_FORM })

  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null)
  const [avatarCleared, setAvatarCleared] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)

  const [prevAgentId, setPrevAgentId] = useState(editorKey)
  if (editorKey !== prevAgentId) {
    setPrevAgentId(editorKey)
    setPendingAvatar(null)
    setAvatarCleared(false)
  }

  const draft = useFormDraft(
    newAgent
      ? NEW_AGENT_DRAFT_KEY
      : agentId
        ? agentSettingsDraftKey(agentId)
        : undefined,
    form,
    'these agent settings',
  )

  // Keep the previous while loading to avoid empty flashing
  const loading =
    !!agentId && (liveAgent === undefined || promptSets === undefined)
  const editingAgent = useStableValue(liveAgent, loading)

  useEffect(() => {
    if (!open || loading) return
    const values = newAgent
      ? newAgentFormValues()
      : editingAgent
        ? agentToFormValues(editingAgent, promptSets ?? EMPTY_AGENT_PROMPT_SETS)
        : EMPTY_AGENT_FORM
    draft.sync(values)
    if (newAgent && !getEditorDraft(NEW_AGENT_DRAFT_KEY)) {
      setEditorDraft(NEW_AGENT_DRAFT_KEY, values)
    }
    // Sync from the live doc on agent switch or when (re)opening the editor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorKey, open, loading])

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
    newAgent ||
    form.formState.isDirty ||
    pendingAvatar !== null ||
    avatarCleared

  function close() {
    view.close()
  }

  function discard() {
    form.reset()
    draft.clear()
    setPendingAvatar(null)
    setAvatarCleared(false)
    if (newAgent) setEditingAgentId(getCreatedAgentId() ?? null)
  }

  // Back must not silently drop unsaved agent settings
  const closeGuard = useViewCloseGuard(AGENT_EDITOR_VIEW, {
    isDirty,
    onDiscard: discard,
  })

  function guard(action: () => void, canSave = false) {
    if (!isDirty) return action()
    setPendingAction({
      proceed: action,
      canSave,
      open: true,
    })
  }

  function confirmPending() {
    const action = pendingAction?.proceed
    discard()
    action?.()
  }

  function handleStageAvatar(file: File | null) {
    setPendingAvatar(file)
    if (file) setAvatarCleared(false)
  }

  const persistSettings = useAgentSettingsPersistence({
    agentId,
    newAgent,
    pendingAvatar,
    avatarCleared,
  })

  async function persist(values: AgentFormValues) {
    if (newAgent) draft.flush(values)
    const savedId = await persistSettings(values)

    form.reset(values)
    draft.clear()
    setPendingAvatar(null)
    setAvatarCleared(false)
    if (newAgent) setEditingAgentId(savedId)
  }

  // Apply persists but keeps the editor open; Save persists then closes.
  const { saving, apply, save } = useSettingsSave(form, persist, close)

  async function savePending() {
    const action = pendingAction?.proceed
    if (action && (await apply())) action()
  }

  function switchToUserSettings() {
    guard(() => view.switchTo('settings', 'user'), true)
  }

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
          <LoadingOverlay
            show={saving}
            className="rounded-lg bg-transparent backdrop-blur-none"
          />

          <Dialog.Header className="justify-between gap-3 border-b px-6 py-4 text-left sm:flex-row sm:items-center">
            <SettingsDialogTitle
              section={newAgent || editingAgent ? activeTabLabel : undefined}
              action={
                <SettingsSwitchButton
                  target="user"
                  disabled={saving}
                  onClick={switchToUserSettings}
                />
              }
            >
              Agents
            </SettingsDialogTitle>
            <AgentPicker
              className="w-full min-w-0 shrink-0 sm:w-80"
              confirmSwitch={(action) => guard(action, true)}
            />
          </Dialog.Header>

          {!newAgent && !editingAgent && !loading && (
            <p className="text-muted-foreground mt-8 px-4 text-center text-sm">
              Select or create an agent to edit its settings.
            </p>
          )}

          {(newAgent || editingAgent) && (
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={newAgent ? (event) => event.preventDefault() : apply}
            >
              <SettingsTabs
                value={activeTab}
                onValueChange={(tab: string) => view.setValue(tab)}
                className="min-h-0 flex-1"
              >
                <SettingsTabs.List className="border-border">
                  {AGENT_SETTINGS_TABS.map(({ value, label, icon: Icon }) => (
                    <SettingsTabs.Trigger
                      key={value}
                      value={value}
                      icon={<Icon />}
                      aria-label={label}
                    >
                      {label}
                    </SettingsTabs.Trigger>
                  ))}
                </SettingsTabs.List>

                <SettingsTabs.Content value="profile">
                  <ProfileSettings
                    control={form.control}
                    avatarId={editingAgent?.avatarId}
                    pendingAvatar={pendingAvatar}
                    avatarCleared={avatarCleared}
                    onStageAvatar={handleStageAvatar}
                    onClearAvatar={() => setAvatarCleared(true)}
                  />
                </SettingsTabs.Content>

                <SettingsTabs.Content
                  ref={toolsScrollRef}
                  value="tools"
                  className="min-w-0"
                >
                  <ToolSettings
                    control={form.control}
                    scrollContainerRef={toolsScrollRef}
                  />
                </SettingsTabs.Content>

                <SettingsTabs.Content value="subagents">
                  <SubagentSettings control={form.control} />
                </SettingsTabs.Content>

                <SettingsTabs.Content value="behavior">
                  <BehaviorGeneralSettings
                    key={editorKey ?? 'none'}
                    control={form.control}
                  />
                  <ContextSettings control={form.control} />
                  <AgentFiles
                    agentId={newAgent ? undefined : (agentId ?? undefined)}
                  />
                </SettingsTabs.Content>

                <SettingsTabs.Content
                  value="skills"
                  className="flex min-h-0 min-w-0 flex-col overflow-hidden"
                >
                  <AgentSkills
                    agentId={newAgent ? undefined : (agentId ?? undefined)}
                  />
                </SettingsTabs.Content>
                <SettingsTabs.Content
                  value="integrations"
                  className="flex min-h-0 min-w-0 flex-col overflow-hidden"
                >
                  <IntegrationSelection
                    agentId={newAgent ? undefined : (agentId ?? undefined)}
                  />
                </SettingsTabs.Content>
                <SettingsTabs.Content value="appearance">
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
                showApply={!newAgent}
              />
            </form>
          )}
        </Dialog.Content>
      </ThemeScope>

      <ConfirmDialog
        open={pendingAction?.open === true || closeGuard.pending}
        onOpenChange={(o) => {
          if (o) return
          setPendingAction((pending) =>
            pending ? { ...pending, open: false } : null,
          )
          closeGuard.cancel()
        }}
        onOpenChangeComplete={(o) => {
          if (o) return
          setPendingAction((pending) => (pending?.open ? pending : null))
        }}
        variant="destructive"
        title={
          pendingAction?.canSave
            ? 'Save changes before switching?'
            : 'Discard changes?'
        }
        description={
          pendingAction?.canSave
            ? 'You have unsaved changes to this agent.'
            : 'Your unsaved changes will be lost.'
        }
        confirmText="Discard"
        cancelText="Keep editing"
        extraAction={
          pendingAction?.canSave
            ? {
                text: 'Save',
                variant: 'primary',
                onConfirm: savePending,
              }
            : undefined
        }
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
