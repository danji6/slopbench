import { useInvertSend } from '@/hooks/chat'
import type { WorkspaceFileIndex } from '@/hooks/chat/workspace'
import { useFullscreenView } from '@/hooks/fullscreen'
import type { PendingMessage } from '@/lib/chat'
import { buildFileItemFromPart, processFileForUpload } from '@/lib/chat/'
import { commandRegistry } from '@/lib/chat/commands'
import type {
  CommandAvailabilityContext,
  CommandDefinition,
} from '@/lib/chat/commands'
import { useComposerDraft } from '@/lib/chat/composer-draft-store'
import type { MentionEntry } from '@/lib/chat/file-mentions'
import { filterMentions } from '@/lib/chat/file-mentions'
import { handleSelectAllDelete } from '@/lib/editor-clear'
import { registerFocusReturn } from '@/lib/focus-return'
import { toastError } from '@/lib/notifications'
import { Result } from '@/lib/result'
import { pasteCollapsedText } from '@/lib/tiptap/paste'
import {
  serializeBlocksToMarkdown,
  setEditorMarkdown,
} from '@/lib/tiptap/serialize'
import { cn } from '@/lib/utils'
import { getActiveMention, mentionToken } from '@sb/core/mentions/parse'
import { parseShellCommand } from '@sb/core/shell/command'
import { truncate } from '@sb/core/utils/strings'
import type { Editor } from '@tiptap/react'
import type { ChatStatus, FileUIPart } from 'ai'
import {
  LightbulbIcon,
  MessageSquareWarningIcon,
  PaperclipIcon,
  PlusIcon,
} from 'lucide-react'
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { DropZoneHandle, InputGroupProps } from '../../ui'
import {
  DropZone,
  DropdownMenu,
  FilePickerOverlay,
  FileStrip,
  FullscreenEditor,
  InputGroup,
  RippleButton,
  fullscreenFill,
  fullscreenGrow,
} from '../../ui'
import { useChatShortcuts } from '../shortcuts'
import { TokenWidget } from '../widgets/token-widget'
import { FileMentionPicker } from '../workspace'
import { CommandPicker } from './command-picker'
import {
  COMPOSER_COMPACT_WIDTH,
  ComposerLayoutProvider,
} from './composer-layout'
import type { ComposerToolbarMode } from './composer-toolbar'
import { SendButton } from './send-button'

const ComposerEditor = lazy(() =>
  import('./composer-editor').then((module) => ({
    default: module.ComposerEditor,
  })),
)

const MENTION_KEYS = new Set(['Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'Escape'])

/** Keeps the slash hint intact when the agent name is long. */
const PLACEHOLDER_NAME_MAX = 24

// Elements the editor shouldn't steal clicks from
const INTERACTIVE = 'a,button,img,input,select,textarea,[contenteditable]'

// Only one composer is ever mounted, so a fixed id is enough to identify it.
const COMPOSER_FULLSCREEN_ID = 'composer'

/** Imperative handle exposed to parents for focusing the composer. */
export type ComposerHandle = {
  focus: (options?: FocusOptions) => void
  /** Replaces the editor content from a markdown string. */
  setContent: (markdown: string) => void
}

export type ChatComposerProps = Omit<InputGroupProps, 'onSubmit'> & {
  onSubmit: (message: PendingMessage) => void
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
  className,
  style,
  ...props
}: ChatComposerProps) {
  const draft = useComposerDraft(draftKey)
  const [message, setMessage] = useState('')
  const [caret, setCaret] = useState(0)
  const [shellCommand, setShellCommand] = useState<string | null>(null)
  const [dismissedMention, setDismissedMention] = useState<string | null>(null)
  const shortcuts = useChatShortcuts()
  const invertSend = useInvertSend()
  const fullscreen = useFullscreenView(COMPOSER_FULLSCREEN_ID)
  const dropZoneRef = useRef<DropZoneHandle>(null)
  const editorRef = useRef<Editor | null>(null)
  const [fileParts, setFileParts] = useState<FileUIPart[]>([])
  const [originalFiles, setOriginalFiles] = useState<Record<string, File>>({})

  const toolbarRef = useRef<HTMLFieldSetElement>(null)
  const [compact, setCompact] = useState(false)
  // Measure the toolbar width to determine what should go in it
  useLayoutEffect(() => {
    const el = toolbarRef.current
    if (!el) return
    const update = () => setCompact(el.clientWidth < COMPOSER_COMPACT_WIDTH)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const layout = useMemo(() => ({ compact }), [compact])

  const isProcessing = status === 'submitted' || status === 'streaming'
  const hasContent = message.trim().length > 0 || fileParts.length > 0

  useEffect(() => {
    onContentChange?.(hasContent)
  }, [hasContent, onContentChange])

  // Suppresses the typing indicator for programmatic content changes so they
  // don't look like the user is writing
  const suppressTypingRef = useRef(false)
  const applyMarkdown = useCallback((editor: Editor, markdown: string) => {
    if (markdown) suppressTypingRef.current = true
    setEditorMarkdown(editor, markdown)
  }, [])

  useImperativeHandle(
    inputRef,
    () => ({
      focus: (options) => editorRef.current?.view.dom.focus(options),
      setContent: (markdown) => {
        const editor = editorRef.current
        if (editor) applyMarkdown(editor, markdown)
      },
    }),
    [applyMarkdown],
  )

  // Closing modals and the window regaining focus hand focus back here
  useEffect(
    () => registerFocusReturn(() => editorRef.current?.view.dom ?? null),
    [],
  )

  const onTypingRef = useRef(onTyping)
  onTypingRef.current = onTyping

  const syncFromEditor = useCallback((editor: Editor) => {
    const { doc, selection } = editor.state
    setMessage(doc.textBetween(0, doc.content.size, '\n'))
    setCaret(doc.textBetween(0, selection.from, '\n').length)
    setShellCommand(editorShellCommand(editor))
  }, [])

  const draftRef = useRef(draft)
  draftRef.current = draft

  const restoredKeyRef = useRef<string>(undefined)
  const restoreDraft = useCallback(
    (editor: Editor) => {
      if (!draftKey || restoredKeyRef.current === draftKey) return
      restoredKeyRef.current = draftKey
      const saved = draftRef.current.read()
      if (saved && editor.isEmpty) applyMarkdown(editor, saved)
    },
    [draftKey, applyMarkdown],
  )

  useEffect(() => {
    const editor = editorRef.current
    if (editor) restoreDraft(editor)
  }, [restoreDraft])

  const handleEditorReady = useCallback(
    (editor: Editor) => {
      editorRef.current = editor
      editor.on('update', () => {
        syncFromEditor(editor)
        draftRef.current.save(serializeBlocksToMarkdown(editor))
        if (suppressTypingRef.current) {
          suppressTypingRef.current = false
          return
        }
        if (editor.state.doc.textContent.trim().length > 0) {
          onTypingRef.current?.()
        }
      })
      editor.on('selectionUpdate', () => syncFromEditor(editor))
      restoreDraft(editor)
      syncFromEditor(editor)
    },
    [syncFromEditor, restoreDraft],
  )

  function handleSurfaceMouseDown(e: React.MouseEvent) {
    const target = e.target as HTMLElement
    // Don't steal clicks from portaled layers (popovers, menus, etc)
    if (!e.currentTarget.contains(target)) return
    if (e.button !== 0 || target.closest(INTERACTIVE)) return
    e.preventDefault()
    const editor = editorRef.current
    if (!editor) return
    editor.view.dom.focus({ preventScroll: true })
    editor.commands.focus(null, { scrollIntoView: false })
  }

  function clearEditor() {
    editorRef.current?.commands.clearContent(true)
    setMessage('')
    setCaret(0)
    setShellCommand(null)
    draft.clear()
  }

  function setEditorText(text: string) {
    const editor = editorRef.current
    if (!editor) return
    editor.chain().setContent(text).focus('end').run()
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
  const shellBlocked = isShellMode && (!shellAvailable || fileParts.length > 0)

  const mentionsEnabled = Boolean(fileIndex?.enabled) && !isCommandMode
  const activeMention = useMemo(
    () => (mentionsEnabled ? getActiveMention(message, caret) : null),
    [mentionsEnabled, message, caret],
  )
  const mentionMatches = useMemo(
    () =>
      activeMention && fileIndex
        ? filterMentions(fileIndex.files, activeMention.query)
        : [],
    [activeMention, fileIndex],
  )
  const mentionSignature = activeMention
    ? `${activeMention.start}:${activeMention.query}`
    : null
  const mentionOpen =
    mentionMatches.length > 0 && mentionSignature !== dismissedMention

  // Reset the highlighted item whenever the candidate list changes
  const [mentionIndex, setMentionIndex] = useState(0)
  const [prevMatches, setPrevMatches] = useState(mentionMatches)
  if (prevMatches !== mentionMatches) {
    setPrevMatches(mentionMatches)
    setMentionIndex(0)
  }

  const ensureFiles = fileIndex?.ensureLoaded
  const refreshFiles = fileIndex?.refresh
  const lastRefreshedMentionStart = useRef<number | null>(null)
  const mentionStart = activeMention?.start ?? null

  useEffect(() => {
    if (mentionStart === null) {
      lastRefreshedMentionStart.current = null
      return
    }
    if (!ensureFiles && !refreshFiles) return
    if (lastRefreshedMentionStart.current === mentionStart) return

    lastRefreshedMentionStart.current = mentionStart
    ensureFiles?.()
    refreshFiles?.()
  }, [ensureFiles, mentionStart, refreshFiles])

  function handleMentionKey(e: KeyboardEvent): boolean {
    const count = mentionMatches.length
    if (e.key === 'ArrowDown') {
      setMentionIndex((i) => (i + 1) % count)
    } else if (e.key === 'ArrowUp') {
      setMentionIndex((i) => (i - 1 + count) % count)
    } else if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
      handleMentionSelect(mentionMatches[mentionIndex] ?? mentionMatches[0]!)
    } else if (e.key === 'Escape') {
      setDismissedMention(mentionSignature)
    } else {
      return false
    }
    return true
  }

  function handleMentionSelect(entry: MentionEntry) {
    const editor = editorRef.current
    if (!activeMention || !editor) return
    const token = mentionToken(entry.path)
    const insert = entry.isDir ? token : `${token} `
    const to = editor.state.selection.from
    const from = to - (activeMention.end - activeMention.start)
    editor.chain().insertContentAt({ from, to }, insert).focus().run()
  }

  const files = useMemo(
    () => fileParts.map((p) => buildFileItemFromPart(p)),
    [fileParts],
  )

  function handleSubmit(silent = false) {
    if (!hasContent) {
      if (canContinue) onContinueAgent?.()
      return
    }
    if (matchedCommand) {
      handleCommandSelect(matchedCommand, silent)
      return
    }
    if (sendDisabled || shellBlocked) return

    onSubmit({
      content: editorRef.current
        ? serializeBlocksToMarkdown(editorRef.current)
        : message,
      files: fileParts,
      ...(silent && { silent: true }),
      ...(Object.keys(originalFiles).length > 0 && { originalFiles }),
    })

    clearEditor()
    setFileParts([])
    setOriginalFiles({})
  }

  function handleCommandSelect(command: CommandDefinition, silent = false) {
    if (!onRunCommand) return
    if (command.requiresArgument && !commandArgument) {
      handleCommandAutocomplete(command)
      return
    }

    onRunCommand(command.name, commandArgument, silent)
    clearEditor()
  }

  function handleCommandAutocomplete(command: CommandDefinition) {
    setEditorText(`/${command.name} `)
  }

  function handleEditorKeyDown(e: KeyboardEvent): boolean {
    const editor = editorRef.current
    if (editor && handleSelectAllDelete(editor.view, e)) return true

    if (
      mentionOpen &&
      MENTION_KEYS.has(e.key) &&
      !(e.key === 'Enter' && e.shiftKey)
    ) {
      return handleMentionKey(e)
    }

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
    const editor = editorRef.current
    return editor ? pasteCollapsedText(editor, e) : false
  }

  async function handleFilePick(picked: File[]) {
    for (const file of picked) {
      try {
        const { part, originalFile } = await processFileForUpload(file)
        setFileParts((prev) => [...prev, part])
        if (originalFile) {
          setOriginalFiles((prev) => ({ ...prev, [part.url]: originalFile }))
        }
      } catch (error) {
        toastError(error, 'Failed to process file')
        return
      }
    }
    dropZoneRef.current?.clear()
  }

  function handleRemoveFile(url: string) {
    setFileParts((prev) => prev.filter((item) => item.url !== url))
    setOriginalFiles((prev) => {
      const { [url]: _, ...rest } = prev
      return rest
    })
  }

  const placeholder =
    (activeAgentName
      ? `Send a message to ${truncate(activeAgentName, PLACEHOLDER_NAME_MAX)}`
      : 'Send a message') + (compact ? '' : ' (or type / for commands)')

  const shellHint = shellBlocked
    ? fileParts.length > 0
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
              onDismiss={clearEditor}
            />
          )}
          {mentionOpen && (
            <FileMentionPicker
              matches={mentionMatches}
              selectedIndex={mentionIndex}
              onSelectedIndexChange={setMentionIndex}
              onSelect={handleMentionSelect}
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
            <FileStrip files={files} onRemove={handleRemoveFile} />
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

/** The shell command that would be run, only if in a leading paragraph. */
function editorShellCommand(editor: Editor): string | null {
  const { doc } = editor.state
  if (doc.firstChild?.type.name !== 'paragraph') return null
  return parseShellCommand(doc.textBetween(0, doc.content.size, '\n'))
}

function ComposerActions({
  mode,
  onAddFiles,
}: {
  mode?: ComposerToolbarMode
  onAddFiles: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger
        render={
          <RippleButton
            size="icon"
            variant="surface"
            aria-label="Composer actions"
          >
            <PlusIcon />
          </RippleButton>
        }
      />
      <DropdownMenu.Content side="top" align="start" className="min-w-48">
        <DropdownMenu.Item onClick={onAddFiles}>
          <PaperclipIcon />
          Add files
        </DropdownMenu.Item>
        {mode?.workspaceAvailable && (
          <>
            <DropdownMenu.Separator />
            <DropdownMenu.Switch
              checked={mode.value === 'plan'}
              onCheckedChange={(checked) =>
                void Result.from(() =>
                  mode.set(checked ? 'plan' : 'normal'),
                ).catch()
              }
            >
              <span className="flex items-center gap-2">
                <LightbulbIcon className="size-4" />
                Plan mode
              </span>
            </DropdownMenu.Switch>
          </>
        )}
      </DropdownMenu.Content>
    </DropdownMenu>
  )
}
