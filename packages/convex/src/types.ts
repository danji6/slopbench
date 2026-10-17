import type {
  SessionListItem as CoreSessionListItem,
  SessionMember as CoreSessionMember,
  SessionParticipant as CoreSessionParticipant,
} from '@sb/core/types'
import type {
  McpServer,
  ModelProviderConfig,
  ToolApprovals,
} from '@sb/core/types'
import type { ReasoningUIPart } from 'ai'
import type { Infer } from 'convex/values'

import type { Doc, Id } from './_generated/dataModel'
import type { SpawnableAgent } from './model/agent/subagents'
import type { PromptSets } from './model/prompts'
import type * as V from './validators'

export type { Role } from './lib/roles'
export type * from '@sb/core/types'

export type McpExecutionArgs = Infer<typeof V.mcpExecutionArgsValidator>

/** An agent with its authoritative shared personal folder state resolved. */
export type AgentWithHome = Doc<'agents'> & { home: Doc<'agentHomes'> | null }

export type StreamContext = {
  stream: RunningStream
  session: Session
  environment: Record<string, unknown>
  toolApprovals?: ToolApprovals
  agent: Doc<'agents'>
  invoker: Doc<'users'>
  invokerSettings: Doc<'settings'> | null
  owner: Doc<'users'>
  ownerSettings: Doc<'settings'> | null
  output: Doc<'messages'>
  settings: Doc<'settings'> | null
  /** Every prompt set the agent resolves to, from the `prompts` table. */
  prompts: PromptSets
  /** Enabled and disabled servers alike, joined with their credentials. */
  mcpServers: McpServer[]
  /** Providers joined with their credentials, for building the model client. */
  modelProviders: ModelProviderConfig[]
  plan: Doc<'plans'> | null
  sessionCache: Doc<'sessionCache'> | null
  spawnableAgents: SpawnableAgent[]
  hasActiveMedia: boolean
}

export type SessionMember = CoreSessionMember<
  Doc<'userSessions'>,
  Id<'avatars'>
>

export type SessionParticipant = CoreSessionParticipant<
  Id<'users'>,
  Id<'agents'>,
  Id<'avatars'>
>

/**
 * Payloads carried by the `messages.extra` field, keyed by the message `type`
 * that owns them.
 */
export type MessageExtra = {
  /** Snapshot of the reminder prompt that produced an injected message. */
  reminder: Infer<typeof V.reminderExtraValidator>
  /** Label of the workspace bound by the change, absent when unbound. */
  workspace: Infer<typeof V.workspaceExtraValidator>
  /** The announced session mode change. */
  mode: Infer<typeof V.modeExtraValidator>
  /** The announced invoked command, and how far it got. */
  command: Infer<typeof V.commandExtraValidator>
}

/** Reasoning parts persist how long the model spent thinking, in ms. */
export type ReasoningPart = ReasoningUIPart & { duration?: number }

export type CommandName = Infer<typeof V.commandNameValidator>
export type DeferredCommandName = Infer<typeof V.deferredCommandNameValidator>
export type CommandStatus = Infer<typeof V.commandStatusValidator>
export type QueuedCommand = Infer<typeof V.queuedCommandValidator>
export type RateLimitRuleArgs = Infer<typeof V.rateLimitRuleArgsValidator>

/** The projection the sidebar renders. */
export type SessionSummary = Pick<
  Doc<'sessions'>,
  | '_id'
  | '_creationTime'
  | 'title'
  | 'activeAgentId'
  | 'lastMessageAt'
  | 'lastMessagePreview'
  | 'firstMessagePreview'
>

export type SessionListItem = CoreSessionListItem<
  SessionSummary,
  Id<'users'>,
  Id<'agents'>,
  Id<'avatars'>
>

export type FolderView = Doc<'sessionFolders'> & {
  workspace: Session['workspace']
  ancestorIds: string[]
  folderPath: string
}

/** A session with its folder-owned filesystem context resolved for this request. */
export type Session = Doc<'sessions'> & {
  workspace?: Infer<typeof V.workspaceRefValidator>
}

export type PromptScope = Infer<typeof V.promptScopeValidator>
export type ReminderScope = Infer<typeof V.reminderScopeValidator>
export type CredentialScope = Infer<typeof V.credentialScopeValidator>
export type NotificationKind = Infer<typeof V.notificationKindValidator>
export type NotificationStatus = Infer<typeof V.notificationStatusValidator>

export type SessionMode = Infer<typeof V.sessionModeValidator>
export type ApprovalMode = Infer<typeof V.approvalModeValidator>
export type PlanStatus = Infer<typeof V.planStatusValidator>
export type TodoStatus = Infer<typeof V.todoStatusValidator>
export type TodoItem = Infer<typeof V.todoItemValidator>

export type SettingsPatch = Infer<typeof V.settingsPatchArgsValidator>
export type SettingsKey = Infer<typeof V.settingsKeyValidator>
export type TokenUsage = Infer<typeof V.tokenUsageValidator>

export type StreamCommand = Infer<typeof V.streamCommandValidator>
export type StreamState = Infer<typeof V.streamStateValidator>
export type ActiveStream = Infer<typeof V.activeStreamValidator>
export type RunningStream = Omit<Doc<'streams'>, 'state'> & {
  state: Extract<StreamState, { phase: 'streaming' }>
}

export type SaveSessionCacheArgs = Infer<typeof V.saveSessionCacheArgsValidator>
export type SendMessageArgs = Infer<typeof V.sendMessageArgsValidator>
export type ConfirmAttachmentArgs = Infer<typeof V.confirmAttachmentArgsValidator> // prettier-ignore
export type CreateGeneratedAttachmentArgs = Infer<typeof V.createGeneratedAttachmentArgsValidator> // prettier-ignore
export type CreateAgentArgs = Infer<typeof V.createAgentArgsValidator>
export type UpdateAgentArgs = Infer<typeof V.updateAgentArgsValidator>
export type UpdateSessionArgs = Infer<typeof V.updateSessionArgsValidator>
export type CreateScriptArgs = Infer<typeof V.createScriptArgsValidator>
export type UpdateScriptArgs = Infer<typeof V.updateScriptArgsValidator>
export type ApproveToolArgs = Infer<typeof V.approveToolArgsValidator>
export type AnswerQuestionsArgs = Infer<typeof V.answerQuestionsArgsValidator>
export type TerminalWriteArgs = Infer<typeof V.terminalWriteArgsValidator>
export type TerminalKillArgs = Infer<typeof V.terminalKillArgsValidator>
export type TerminalResizeArgs = Infer<typeof V.terminalResizeArgsValidator>
export type TerminalSessionArgs = Infer<typeof V.terminalSessionArgsValidator>
export type TerminalPollArgs = Infer<typeof V.terminalPollArgsValidator>
export type ImportSessionArgs = Infer<typeof V.importSessionArgsValidator>
export type MessageWindowArgs = Infer<typeof V.messagesWindowArgsValidator>
export type PartAddress = Infer<typeof V.partAddressValidator>
export type EditMessagePartArgs = Infer<typeof V.editMessagePartArgsValidator>
export type DeleteMessagePartsArgs = Infer<typeof V.deleteMessagePartsArgsValidator> // prettier-ignore
export type FolderTransitionArgs = Infer<typeof V.folderTransitionArgs>
export type FolderCreateArgs = Infer<typeof V.folderCreateArgs>
export type FolderCreateBasicArgs = Infer<typeof V.folderCreateBasicArgs>
export type FolderMoveArgs = Infer<typeof V.folderMoveArgs>
export type FolderCommand = Infer<typeof V.folderCommandValidator>
export type FolderCommitPlan = Infer<typeof V.folderCommitPlanValidator>
export type FolderCommitArgs = Infer<typeof V.folderCommitArgs>
export type FolderCancelArgs = Infer<typeof V.folderCancelArgs>
export type FolderLockTarget = Infer<typeof V.folderLockTargetValidator>
export type CompleteAgentFileArgs = Infer<typeof V.completeAgentFileArgsValidator> // prettier-ignore
export type FailAgentFileArgs = Infer<typeof V.failAgentFileArgsValidator>
export type PrepareSkillImportArgs = Infer<typeof V.prepareSkillImportArgsValidator> // prettier-ignore
export type FinishSkillImportArgs = Infer<typeof V.finishSkillImportArgsValidator> // prettier-ignore
export type InvalidateAgentHomeArgs = Infer<typeof V.invalidateAgentHomeArgsValidator> // prettier-ignore
export type SkillListArgs = Infer<typeof V.skillListArgsValidator>
export type RemoveMissingSkillArgs = Infer<typeof V.removeMissingSkillArgsValidator> // prettier-ignore
export type VerifySkillIdsArgs = Infer<typeof V.verifySkillIdsValidator>
export type SkillVerificationPage = Infer<typeof V.skillVerificationPageValidator> // prettier-ignore
export type FileOperationArgs = Infer<typeof V.fileOperationArgsValidator>
export type SkillAssignmentsArgs = Infer<typeof V.skillAssignmentsArgsValidator> // prettier-ignore
export type ContinueSkillImportArgs = Infer<typeof V.continueSkillImportArgsValidator> // prettier-ignore
export type CopySkillAssignmentsArgs = Infer<typeof V.copySkillAssignmentsArgsValidator> // prettier-ignore
export type ReserveHomeArgs = Infer<typeof V.reserveHomeArgsValidator>
export type OperationAttemptArgs = Infer<typeof V.operationAttemptArgsValidator>
export type OperationResult = Infer<typeof V.operationResultValidator>
export type StreamExecutionArgs = Infer<typeof V.streamExecutionArgsValidator>
export type PatchStreamMessageArgs = Infer<typeof V.patchStreamMessageArgsValidator> // prettier-ignore
export type RecordStreamStepArgs = Infer<typeof V.recordStreamStepArgsValidator>
export type FailStreamArgs = Infer<typeof V.failStreamArgsValidator>
export type TrackStreamOutputArgs = Infer<typeof V.trackStreamOutputArgsValidator> // prettier-ignore
export type SaveStreamMetaArgs = Infer<typeof V.saveStreamMetaArgsValidator>
export type ScheduleStreamRetryArgs = Infer<typeof V.scheduleStreamRetryArgsValidator> // prettier-ignore
export type SaveStreamCacheArgs = Infer<typeof V.saveStreamCacheArgsValidator>
export type SaveStreamEnvironmentArgs = Infer<typeof V.saveStreamEnvironmentArgsValidator> // prettier-ignore
export type SaveStreamLogArgs = Infer<typeof V.saveStreamLogArgsValidator>
export type CreateModelProviderArgs = Infer<typeof V.createModelProviderArgsValidator> // prettier-ignore
export type UpdateModelProviderArgs = Infer<typeof V.updateModelProviderArgsValidator> // prettier-ignore
export type DiscoveryRun = Infer<typeof V.discoveryRunValidator>
export type SaveProvidersArgs = Infer<typeof V.saveProvidersArgsValidator>
export type EnsureConnectionArgs = Infer<typeof V.ensureConnectionArgsValidator>
export type PreviewDiscoveryArgs = Infer<typeof V.previewDiscoveryArgsValidator>
export type PreviewDetailArgs = Infer<typeof V.previewDetailArgsValidator>
export type StorePreviewArgs = Infer<typeof V.storePreviewArgsValidator>
export type PreviewModelDetailsArgs = Infer<typeof V.previewModelDetailsArgsValidator> // prettier-ignore
export type RemovedConnectionArgs = Infer<typeof V.removedConnectionArgsValidator> // prettier-ignore
export type DetailTargetsArgs = Infer<typeof V.detailTargetsArgsValidator>

export type ProviderDiscovery = Infer<typeof V.providerDiscoveryValidator>
