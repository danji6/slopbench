import { useInvertSend } from '@/hooks/chat'
import type { WorkspaceFileIndex } from '@/hooks/chat/workspace'
import { useFullscreenView } from '@/hooks/fullscreen'
import type { PendingMessage } from '@/lib/chat'
import { commandRegistry } from '@/lib/chat/commands'
import type {
  CommandAvailabilityContext,
  CommandDefinition,
} from '@/lib/chat/commands'
import { handleSelectAllDelete } from '@/lib/editor-clear'
import { toastError } from '@/lib/notifications'
import { pasteCollapsedText } from '@/lib/tiptap/paste'
import { serializeBlocksToMarkdown } from '@/lib/tiptap/serialize'
import { cn } from '@/lib/utils'
import { shouldAttachTextPaste } from '@sb/core/attachments'
import { truncate } from '@sb/core/utils/strings'
import type { Editor } from '@tiptap/react'
import type { ChatStatus } from 'ai'
import { MessageSquareWarningIcon } from 'lucide-react'
import { Suspense, lazy, useEffect, useRef } from 'react'

import type { DropZoneHandle, InputGroupProps } from '../../ui'
import {
  DropZone,
  FilePickerOverlay,
  FileStrip,
  FullscreenEditor,
  InputGroup,
  fullscreenFill,
  fullscreenGrow,
} from '../../ui'
import { useChatShortcuts } from '../shortcuts'
import { TokenWidget } from '../widgets/token-widget'
import { FileMentionPicker } from '../workspace'
import { CommandPicker } from './command-picker'
import {
  ComposerLayoutProvider,
  useMeasuredComposerLayout,
} from './composer-layout'
import { ComposerActions } from './composer-toolbar'
import type { ComposerToolbarMode } from './composer-toolbar'
import { SendButton } from './send-button'
import { useComposerAttachments } from './use-composer-attachments'
import { useComposerEditor } from './use-composer-editor'
import type { ComposerHandle } from './use-composer-editor'
import { useComposerMentions } from './use-composer-mentions'

export type { ComposerHandle } from './use-composer-editor'

const ComposerEditor = lazy(() =>
  import('./composer-editor').then((module) => ({
    default: module.ComposerEditor,
  })),
)

/** Keeps the slash hint intact when the agent name is long. */
const PLACEHOLDER_NAME_MAX = 24

// Only one composer is ever mounted, so a fixed id is enough to identify it.
const COMPOSER_FULLSCREEN_ID = 'composer'

export type ChatComposerProps = Omit<InputGroupProps, 'onSubmit'> & {
  onSubmit: (message: PendingMessage) => void | Promise<void>
  onStop?: () => void
  onRunCommand?: (name: string, argument: string, silent: boolean) => void
  onContinueAgent?: () => void
  canContinueAgent?: boolean
  commandAvailability?: CommandAvailabilityContext
  status?: ChatStatus
  hideTokenWidget?: boolean
  /** Name of the active agent, used for the composer placeholder. */
  activeAgentName?: string
  /** Optional content rendered in the action bar, left of the attach button. */
  startContent?: React.ReactNode
  /** Session mode exposed through the attach menu. */
  mode?: ComposerToolbarMode
  onContentChange?: (hasContent: boolean) => void
  /** Fired on content change while the composer has text. */
  onTyping?: () => void
  /** Imperative handle for focusing the composer. */
  inputRef?: React.Ref<ComposerHandle>
  focusOnMount?: boolean
  /** Workspace file index enabling `@path/to/file` mention autocomplete. */
  fileIndex?: WorkspaceFileIndex
  /** Whether agent invocation should be non-automatic. */
  passiveSend?: boolean
  /** Whether sending messages should be disabled. */
  sendDisabled?: boolean
  /** Whether shell commands can run (admin with a bound workspace). */
  shellAvailable?: boolean
  /**
   * Draft key: a session id, or `NO_SESSION_DRAFT_KEY` outside of a session.
   * Omit to disable persistence.
   */
  draftKey?: string
  /** Restores a first message whose upload failed after session creation. */
  restoreMessage?: PendingMessage | null
}

export function ChatComposer({
  onSubmit,
  onStop,
  onRunCommand,
  onContinueAgent,
  canContinueAgent = false,
  commandAvailability,
  status,
  hideTokenWidget,
  activeAgentName,
  startContent,
  mode,
  onContentChange,
  onTyping,
  inputRef,
  focusOnMount = true,
  fileIndex,
  passiveSend = false,
  sendDisabled = false,
  shellAvailable = false,
  draftKey,
  restoreMessage,
  className,
  style,
  ...props
}: ChatComposerProps) {
  const shortcuts = useChatShortcuts()
  const invertSend = useInvertSend()
  const fullscreen = useFullscreenView(COMPOSER_FULLSCREEN_ID)
  const dropZoneRef = useRef<DropZoneHandle>(null)
  const editorRef = useRef<Editor | null>(null)

  const attachments = useComposerAttachments({ draftKey, editorRef })
  const { compact, layout, toolbarRef } = useMeasuredComposerLayout()
  const {
    caret,
    clearEditor,
    handleEditorReady,
    handleSurfaceMouseDown,
    message,
    setEditorText,
    shellCommand,
  } = useComposerEditor({
    draftKey,
    editorRef,
    inputRef,
    onRestoreMessage: attachments.restoreAttachments,
    onTyping,
    restoreMessage,
  })

  const isProcessing = status === 'submitted' || status === 'streaming'
  const hasContent =
    message.trim().length > 0 || attachments.fileParts.length > 0

  useEffect(() => {
    onContentChange?.(hasContent)
  }, [hasContent, onContentChange])

  function clearComposer() {
    clearEditor()
    attachments.clearAttachmentDraft()
  }

  const isStop = isProcessing && !hasContent
  const canContinue = canContinueAgent && !isStop

  const availableCommands = commandRegistry.list(commandAvailability)
  const isCommandMode = message.startsWith('/')
  const commandName = isCommandMode
    ? (message.slice(1).split(/\s+/)[0] ?? '')
    : ''
  const isTypingCommandName = isCommandMode && !/\s/.test(message.slice(1))
  const matchedCommand = isCommandMode
    ? commandRegistry.get(commandName, commandAvailability)
    : undefined
  const commandArgument = isCommandMode
    ? message.slice(1).slice(commandName.length).trim()
    : ''

  // Shell command runs in the workspace instead of being sent as a message
  const isShellMode = shellCommand !== null
  const shellBlocked =
    isShellMode && (!shellAvailable || attachments.fileParts.length > 0)
  const mentions = useComposerMentions({
    caret,
    editorRef,
    enabled: Boolean(fileIndex?.enabled) && !isCommandMode,
    fileIndex,
    message,
  })

  async function handleSubmit(silent = false) {
    if (!hasContent) {
      if (canContinue) onContinueAgent?.()
      return
    }
    if (matchedCommand) {
      handleCommandSelect(matchedCommand, silent)
      return
    }
    if (sendDisabled || shellBlocked) return

    try {
      await onSubmit({
        content: editorRef.current
          ? serializeBlocksToMarkdown(editorRef.current)
          : message,
        files: attachments.fileParts,
        ...(silent && { silent: true }),
        ...(Object.keys(attachments.originalFiles).length > 0 && {
          originalFiles: attachments.originalFiles,
        }),
        ...(Object.keys(attachments.pastedText).length > 0 && {
          pastedText: attachments.pastedText,
        }),
      })

      clearComposer()
      attachments.resetAttachments()
    } catch (error) {
      toastError(error, 'Failed to send message')
    }
  }

  function handleCommandSelect(command: CommandDefinition, silent = false) {
    if (!onRunCommand) return
    if (command.requiresArgument && !commandArgument) {
      handleCommandAutocomplete(command)
      return
    }

    onRunCommand(command.name, commandArgument, silent)
    clearComposer()
  }

  function handleCommandAutocomplete(command: CommandDefinition) {
    setEditorText(`/${command.name} `)
  }

  function handleEditorKeyDown(e: KeyboardEvent): boolean {
    const editor = editorRef.current
    if (editor && handleSelectAllDelete(editor.view, e)) return true

    if (mentions.handleKey(e)) return true

    // Escape stops an in-flight or debouncing agent turn if not fullscreen
    if (e.key === 'Escape' && isStop && !fullscreen.active) {
      onStop?.()
      return true
    }

    // Up edits the last user message (empty composer)
    if (e.key === 'ArrowUp' && !hasContent && !isCommandMode) {
      return shortcuts?.editLatestUserMessage() ?? false
    }

    // In command mode, Enter runs the matched command
    if (isCommandMode && e.key === 'Enter' && !e.shiftKey) {
      if (matchedCommand)
        handleCommandSelect(matchedCommand, e.ctrlKey || e.metaKey)
      return true
    }

    if (e.key !== 'Enter') return false

    const modifier = e.ctrlKey || e.metaKey

    // Ctrl+Enter is the secondary send (silent message by default)
    if (modifier) {
      if (!hasContent) {
        // Without content it invokes the agent
        if (canContinue) handleSubmit()
        return true
      }
      handleSubmit(!passiveSend)
      return true
    }

    // Between Enter and Shift+Enter, invertSend decides which one sends
    const isSendChord = invertSend ? e.shiftKey : !e.shiftKey
    if (isSendChord) {
      if (!hasContent) {
        if (canContinue) handleSubmit()
        return true
      }
      // Primary send (silent when passiveSend is on)
      handleSubmit(passiveSend)
      return true
    }

    // Enter continues the agent when the composer has no content
    if (!hasContent && canContinue) {
      handleSubmit()
      return true
    }

    // Newline insertion
    return false
  }

  function handleEditorPaste(e: ClipboardEvent): boolean {
    const pasted = e.clipboardData?.files

    if (pasted && pasted.length > 0) {
      void handleFilePick(Array.from(pasted))
      return true
    }

    const text = e.clipboardData?.getData('text/plain') ?? ''
    if (shouldAttachTextPaste(text, isCommandMode || shellCommand !== null)) {
      const position = editorRef.current?.state.selection.from ?? 0
      void attachments.addLargeTextPaste(text, position)
      return true
    }

    const editor = editorRef.current
    return editor ? pasteCollapsedText(editor, e) : false
  }

  async function handleFilePick(picked: File[]) {
    if (await attachments.addFiles(picked)) dropZoneRef.current?.clear()
  }

  const placeholder =
    (activeAgentName
      ? `Send a message to ${truncate(activeAgentName, PLACEHOLDER_NAME_MAX)}`
      : 'Send a message') + (compact ? '' : ' (or type / for commands)')

  const shellHint = shellBlocked
    ? attachments.fileParts.length > 0
      ? 'Shell commands cannot carry attachments'
      : 'Shell commands require admin access and a bound workspace'
    : null

  return (
    <ComposerLayoutProvider value={layout}>
      <FullscreenEditor id={COMPOSER_FULLSCREEN_ID}>
        <DropZone
          ref={dropZoneRef}
          onDrop={handleFilePick}
          noInputEvents
          noFocus
          className={cn(
            'bg-m3-surface-container-low supports-backdrop-filter:bg-m3-surface-container-low/80 pointer-events-auto relative w-full rounded-3xl supports-backdrop-filter:backdrop-blur-2xl',
            className,
            fullscreenFill,
            'group-data-fullscreen/fullscreen:flex group-data-fullscreen/fullscreen:flex-col',
          )}
          style={style}
        >
          {isTypingCommandName && (
            <CommandPicker
              query={commandName}
              commands={availableCommands}
              onSelect={handleCommandSelect}
              onAutocomplete={handleCommandAutocomplete}
              onDismiss={clearComposer}
            />
          )}
          {mentions.open && (
            <FileMentionPicker
              matches={mentions.matches}
              selectedIndex={mentions.selectedIndex}
              onSelectedIndexChange={mentions.setSelectedIndex}
              onSelect={mentions.select}
            />
          )}
          {shellHint && <Hint>{shellHint}</Hint>}
          <FilePickerOverlay className="rounded-3xl" />
          <InputGroup
            data-slot="chat-box"
            className={cn(
              'w-full overflow-hidden rounded-3xl! bg-transparent pt-1',
              fullscreenFill,
            )}
            {...props}
            onMouseDown={handleSurfaceMouseDown}
          >
            <FileStrip
              files={attachments.files}
              onRemove={attachments.removeFile}
              onInsertInline={attachments.insertInline}
            />
            <FullscreenEditor.Toolbar className="mr-1 self-stretch group-data-fullscreen/fullscreen:mr-0" />
            <div
              className={cn(
                'max-h-60 min-h-9 w-full overflow-y-auto px-5',
                fullscreenFill,
                fullscreenGrow,
              )}
              style={{
                fontFamily: 'var(--chat-font-family)',
                fontSize: 'var(--chat-font-size)',
              }}
            >
              <Suspense fallback={null}>
                <ComposerEditor
                  placeholder={placeholder}
                  autoFocus={focusOnMount}
                  editorClassName="pt-2 [&_p]:mt-0! pr-6! group-data-[fullscreen]/fullscreen:pr-0!"
                  onReady={handleEditorReady}
                  handleKeyDown={(_view, event) => handleEditorKeyDown(event)}
                  handlePaste={(_view, event) => handleEditorPaste(event)}
                />
              </Suspense>
            </div>
            <InputGroup.Addon
              ref={toolbarRef}
              align="block-end"
              className="px-3 pt-4 pb-2.5"
            >
              <span className="bg-m3-surface-container flex min-w-0 shrink items-center gap-1 rounded-full px-[5.5px] py-1">
                <ComposerActions
                  mode={mode}
                  onAddFiles={() => dropZoneRef.current?.open()}
                />
                {startContent && (
                  <>
                    <div className="bg-border/80 h-7 w-px shrink-0" />
                    {startContent}
                  </>
                )}
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                {!hideTokenWidget && <TokenWidget />}
                <SendButton
                  isStop={isStop}
                  disabled={
                    (!isStop && !hasContent && !canContinue) ||
                    (sendDisabled && hasContent) ||
                    shellBlocked
                  }
                  canSendSilently={hasContent && !isStop}
                  canContinueAgent={canContinue}
                  onSend={handleSubmit}
                  onStop={onStop}
                  onContinueAgent={onContinueAgent}
                />
              </div>
            </InputGroup.Addon>
          </InputGroup>
        </DropZone>
      </FullscreenEditor>
    </ComposerLayoutProvider>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-slot="shell-hint"
      className="bg-m3-surface-container-low text-muted-foreground absolute right-2 bottom-full left-2 mb-1.5 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs shadow-lg"
    >
      <MessageSquareWarningIcon className="size-4 shrink-0" />
      {children}
    </div>
  )
}
