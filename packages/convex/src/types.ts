import type {
  SessionListItem as CoreSessionListItem,
  SessionMember as CoreSessionMember,
  SessionParticipant as CoreSessionParticipant,
} from '@cv/core/types'
import type {
  McpServer,
  ModelProviderConfig,
  ToolApprovals,
} from '@cv/core/types'
import type { ReasoningUIPart } from 'ai'
import type { Infer } from 'convex/values'

import type { Doc, Id } from './_generated/dataModel'
import type { SpawnableAgent } from './model/agent/subagents'
import type { PromptSets } from './model/prompts'
import type * as V from './validators'
import type * as ChangesV from './validators/changes'
import type * as McpBrokerV from './validators/mcpBroker'
import type * as McpCatalogsV from './validators/mcpCatalogs'
import type * as McpOperationsV from './validators/mcpOperations'
import type * as McpProtocolV from './validators/mcpProtocol'
import type * as ProviderRequestsV from './validators/providerRequests'
import type * as StreamsV from './validators/streams'
import type * as ToolkitsV from './validators/toolkits'

export type { Role } from './lib/roles'
export type * from '@cv/core/types'

export type McpServerInput = Infer<
  typeof V.replaceMcpServersArgsValidator
>['servers'][number]

/** An agent with its authoritative shared personal folder state resolved. */
export type AgentWithHome = Doc<'agents'> & { home: Doc<'agentHomes'> | null }

export type StreamContext = {
  stream: RunningStream
  session: Session
  environment: Record<string, unknown>
  toolApprovals?: ToolApprovals
  agent: AgentWithHome
  hasStoredMcpOutput?: boolean
  hasToolkitSkills?: boolean
  toolkitContext?: Infer<typeof V.toolkitContextValidator>[]
  toolkitSkillRevision?: string
  invoker: Doc<'users'>
  invokerSettings: Doc<'settings'> | null
  owner: Doc<'users'>
  ownerSettings: Doc<'settings'> | null
  output: Doc<'messages'> & { parts: unknown[] }
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

export type PrepareContextNoteArgs = Infer<
  typeof V.prepareContextNoteArgsValidator
>

/**
 * Payloads carried by the `messages.extra` field, keyed by the message `type`
 * that owns them.
 */
export type MessageExtra = {
  capabilities: Infer<typeof V.skillsExtraValidator>
  mcp: Infer<typeof V.skillsExtraValidator>
  skills: Infer<typeof V.skillsExtraValidator>
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
export type NotificationApproval = Infer<typeof V.notificationApprovalValidator>
export type NotificationApprovalAction = Infer<typeof V.notificationApprovalActionValidator> // prettier-ignore

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

export type PartAddress = Infer<typeof V.partAddressValidator>

export type FolderCommand = Infer<typeof V.folderCommandValidator>
export type FolderCommitPlan = Infer<typeof V.folderCommitPlanValidator>

export type ProviderDiscovery = Infer<typeof V.providerDiscoveryValidator>
export type NotificationRequest = Infer<typeof V.notificationRequestValidator>
export type NotificationRequestState = Infer<typeof V.notificationRequestStateValidator> // prettier-ignore

export type CacheDiagnostic = Infer<typeof ProviderRequestsV.cacheDiagnosticValidator> // prettier-ignore
export type ProviderContinuityScope = Infer<typeof ProviderRequestsV.providerContinuityScopeValidator> // prettier-ignore

export type AttachmentCursorCall = Infer<typeof V.attachmentCursorCall>
export type AttachmentCursorSettings = Infer<typeof V.attachmentCursorSettings>

export type SaveSessionCacheArgs = Infer<typeof V.saveSessionCacheArgsValidator>
export type SendMessageArgs = Infer<typeof V.sendMessageArgsValidator>
export type ConfirmAttachmentArgs = Infer<typeof V.confirmAttachmentArgsValidator> // prettier-ignore
export type CreateGeneratedAttachmentArgs = Infer<typeof V.createGeneratedAttachmentArgsValidator> // prettier-ignore
export type CreateAgentArgs = Infer<typeof V.createAgentArgsValidator>
export type UpdateAgentArgs = Infer<typeof V.updateAgentArgsValidator>
export type UpdateSessionArgs = Infer<typeof V.updateSessionArgsValidator>
export type ListSessionsArgs = Infer<typeof V.listSessionsArgsValidator>
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
export type EditMessagePartArgs = Infer<typeof V.editMessagePartArgsValidator>
export type DeleteMessagePartsArgs = Infer<typeof V.deleteMessagePartsArgsValidator> // prettier-ignore
export type FolderTransitionArgs = Infer<typeof V.folderTransitionArgs>
export type FolderCreateArgs = Infer<typeof V.folderCreateArgs>
export type FolderCreateBasicArgs = Infer<typeof V.folderCreateBasicArgs>
export type FolderMoveArgs = Infer<typeof V.folderMoveArgs>
export type FolderCommitArgs = Infer<typeof V.folderCommitArgs>
export type FolderCancelArgs = Infer<typeof V.folderCancelArgs>
export type FolderLockTarget = Infer<typeof V.folderLockTargetValidator>
export type CompleteAgentFileArgs = Infer<typeof V.completeAgentFileArgsValidator> // prettier-ignore
export type FailAgentFileArgs = Infer<typeof V.failAgentFileArgsValidator>
export type PrepareSkillImportArgs = Infer<typeof V.prepareSkillImportArgsValidator> // prettier-ignore
export type FinishSkillImportArgs = Infer<typeof V.finishSkillImportArgsValidator> // prettier-ignore
export type InvalidateAgentHomeArgs = Infer<typeof V.invalidateAgentHomeArgsValidator> // prettier-ignore
export type SkillListArgs = Infer<typeof V.skillListArgsValidator>
export type SetSkillEnabledArgs = Infer<typeof V.setSkillEnabledArgsValidator>
export type RemoveMissingSkillArgs = Infer<typeof V.removeMissingSkillArgsValidator> // prettier-ignore
export type VerifySkillIdsArgs = Infer<typeof V.verifySkillIdsValidator>
export type SkillVerificationPage = Infer<typeof V.skillVerificationPageValidator> // prettier-ignore
export type FileOperationArgs = Infer<typeof V.fileOperationArgsValidator>
export type SkillAssignmentsArgs = Infer<typeof V.skillAssignmentsArgsValidator> // prettier-ignore
export type ContinueSkillImportArgs = Infer<typeof V.continueSkillImportArgsValidator> // prettier-ignore
export type RemoveDeletedAssignmentArgs = Infer<typeof V.removeDeletedAssignmentArgsValidator> // prettier-ignore
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
export type McpExecutionArgs = Infer<typeof V.mcpExecutionArgsValidator>
export type DiscoverMcpToolsArgs = Infer<typeof V.discoverMcpToolsArgsValidator>
export type McpRuntimeArgs = Infer<typeof V.mcpRuntimeArgsValidator>
export type McpCleanupArgs = Infer<typeof V.mcpCleanupArgsValidator>
export type McpRuntimeControlArgs = Infer<typeof V.mcpRuntimeControlArgsValidator> // prettier-ignore
export type McpRuntimeConnectedArgs = Infer<typeof V.mcpRuntimeConnectedArgsValidator> // prettier-ignore
export type McpRuntimeStatusArgs = Infer<typeof V.mcpRuntimeStatusArgsValidator>
export type McpRuntimeRetireArgs = Infer<typeof V.mcpRuntimeRetireArgsValidator>
export type McpRuntimeListArgs = Infer<typeof V.mcpRuntimeListArgsValidator>
export type McpRuntimePageArgs = Infer<typeof V.mcpRuntimePageArgsValidator>
export type McpReserveArgs = Infer<typeof McpOperationsV.mcpReserveArgsValidator> // prettier-ignore
export type McpObserveArgs = Infer<typeof McpOperationsV.mcpObserveArgsValidator> // prettier-ignore
export type McpOperationArgs = Infer<typeof McpOperationsV.mcpOperationArgsValidator> // prettier-ignore
export type McpOperationExecutionArgs = Infer<typeof McpOperationsV.mcpOperationExecutionValidator> // prettier-ignore
export type McpOperationFindArgs = Infer<typeof McpOperationsV.mcpOperationFindValidator> // prettier-ignore
export type McpBrokerServerArgs = Infer<typeof McpBrokerV.brokerServerValidator>
export type McpBrokerTargetArgs = Infer<typeof McpBrokerV.brokerTargetValidator>
export type McpBrokerSearchArgs = Infer<typeof McpBrokerV.brokerSearchValidator>
export type McpBrokerOutputArgs = Infer<typeof McpBrokerV.brokerOutputValidator>
export type McpCatalogIdArgs = Infer<typeof McpCatalogsV.catalogIdValidator>
export type McpCatalogActiveFailureArgs = Infer<typeof McpCatalogsV.catalogActiveFailureValidator> // prettier-ignore
export type McpCatalogSweepArgs = Infer<typeof McpCatalogsV.catalogSweepValidator> // prettier-ignore
export type McpCatalogBeginArgs = Infer<typeof McpCatalogsV.catalogBeginValidator> // prettier-ignore
export type McpCatalogAppendArgs = Infer<typeof McpCatalogsV.catalogAppendValidator> // prettier-ignore
export type McpCatalogPublishArgs = Infer<typeof McpCatalogsV.catalogPublishValidator> // prettier-ignore
export type McpCatalogFailureArgs = Infer<typeof McpCatalogsV.catalogFailureValidator> // prettier-ignore
export type McpCatalogPageArgs = Infer<typeof McpCatalogsV.catalogPageValidator> // prettier-ignore
export type McpCatalogTargetArgs = Infer<typeof McpCatalogsV.catalogTargetValidator> // prettier-ignore
export type McpCatalogSearchArgs = Infer<typeof McpCatalogsV.catalogSearchValidator> // prettier-ignore
export type McpCatalogActiveArgs = Infer<typeof McpCatalogsV.catalogActiveValidator> // prettier-ignore
export type McpCatalogDefinitionAccessArgs = Infer<typeof McpCatalogsV.catalogDefinitionAccessValidator> // prettier-ignore
export type McpProtocolRequestArgs = Infer<typeof McpProtocolV.protocolRequestValidator> // prettier-ignore
export type McpProtocolPublishArgs = Infer<typeof McpProtocolV.protocolPublishValidator> // prettier-ignore
export type ToolkitPublishArgs = Infer<typeof ToolkitsV.toolkitPublishValidator> // prettier-ignore
export type ToolkitSettingsArgs = Infer<typeof ToolkitsV.toolkitSettingsValidator> // prettier-ignore
export type ToolkitSelectionArgs = Infer<typeof ToolkitsV.toolkitSelectionValidator> // prettier-ignore
export type ToolkitListArgs = Infer<typeof ToolkitsV.toolkitListValidator> // prettier-ignore
export type ToolkitComponentArgs = Infer<typeof ToolkitsV.toolkitComponentValidator> // prettier-ignore
export type ToolkitMissingArgs = Infer<typeof ToolkitsV.toolkitMissingValidator> // prettier-ignore
export type ToolkitSkillReadArgs = Infer<typeof ToolkitsV.toolkitSkillReadValidator> // prettier-ignore
export type ToolkitObservationArgs = Infer<typeof ToolkitsV.toolkitObservationValidator> // prettier-ignore
export type ToolkitSkillsArgs = Infer<typeof ToolkitsV.toolkitSkillsValidator> // prettier-ignore
export type FolderPageArgs = Infer<typeof V.folderPageArgs>
export type FolderPickerArgs = Infer<typeof V.folderPickerArgs>
export type PrepareChangesArgs = Infer<typeof ChangesV.prepareChangesArgsValidator> // prettier-ignore
export type RestoreChangesArgs = Infer<typeof ChangesV.restoreChangesArgsValidator> // prettier-ignore
export type PublishChangesArgs = Infer<typeof ChangesV.publishChangesArgsValidator> // prettier-ignore
export type RestoreChangesResultArgs = Infer<typeof ChangesV.restoreChangesResultValidator> // prettier-ignore
export type AppendChangesArgs = Infer<typeof ChangesV.appendChangesArgsValidator> // prettier-ignore
export type ReservePublicationArgs = Infer<typeof ChangesV.reservePublicationArgsValidator> // prettier-ignore
export type AgentPageArgs = Infer<typeof V.agentPageArgsValidator>
export type PrepareProviderRequestArgs = Infer<typeof StreamsV.prepareProviderRequestArgsValidator> // prettier-ignore
export type SaveProviderContinuityArgs = Infer<typeof StreamsV.saveProviderContinuityArgsValidator> // prettier-ignore
export type RecordCacheDiagnosticArgs = Infer<typeof StreamsV.recordCacheDiagnosticArgsValidator> // prettier-ignore
export type PrepareCapabilitiesArgs = Infer<typeof V.prepareCapabilitiesArgsValidator> // prettier-ignore
export type AssertToolAccessArgs = Infer<typeof V.assertToolAccessArgsValidator>
export type ShellDeliveryPositionArgs = Infer<typeof V.shellDeliveryPositionArgsValidator> // prettier-ignore
export type SaveAttachmentCursorArgs = Infer<typeof V.saveAttachmentCursorArgs>
