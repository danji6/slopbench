import { EditableText } from '@/components/chat/messages/editor/editable-text'
import { ScriptManager } from '@/components/chat/messages/editor/menu/script-manager'
import { ScriptToolbarContent } from '@/components/chat/messages/editor/menu/script-toolbar'
import {
  MessageEditProvider,
  useMessageEdit,
} from '@/components/chat/messages/editor/message-edit-context'
import { MessageContext } from '@/components/chat/messages/message-context'
import { MessageContextMenu } from '@/components/chat/messages/message-context-menu'
import '@/globals.css'
import { ChatMessagesProvider } from '@/hooks/chat/messages'
import { DEFAULT_SETTINGS } from '@sb/convex/model/defaults'
import type { UIMessage } from 'ai'
import { ConvexQueryCacheProvider } from 'convex-helpers/react/cache'
import { ConvexProvider, type ConvexReactClient } from 'convex/react'
import { type FunctionReference, getFunctionName } from 'convex/server'
import { useState } from 'react'

const scripts: unknown[] = []
const attachmentOnly = new URLSearchParams(location.search).get(
  'attachmentOnly',
)
const message: UIMessage = {
  id: 'fixture',
  role: attachmentOnly === 'assistant' ? 'assistant' : 'user',
  parts: attachmentOnly
    ? [{ type: 'file', mediaType: 'image/svg+xml', url: '/favicon.svg' }]
    : [{ type: 'text', text: 'Fixture text' }],
}

/** Supplies stable query results while failing any accidental write. */
const client = {
  watchQuery(reference: FunctionReference<'query'>) {
    const name = getFunctionName(reference)
    const value =
      name === 'editorScripts:list'
        ? scripts
        : name === 'settings:get'
          ? DEFAULT_SETTINGS
          : null
    return {
      onUpdate: () => () => {},
      localQueryResult: () => value,
      localQueryLogs: () => [],
      journal: () => undefined,
    }
  },
  mutation() {
    throw new Error('Menu interaction must not write to the server')
  },
} as unknown as ConvexReactClient

function Menus() {
  const [readOnly, setReadOnly] = useState(false)
  const [actions, setActions] = useState(0)
  const edit = useMessageEdit()
  const [part] = message.parts
  return (
    <main className="flex flex-col items-start gap-8 p-8">
      <label>
        <input
          type="checkbox"
          checked={readOnly}
          onChange={(event) => setReadOnly(event.target.checked)}
        />
        Read only
      </label>
      <MessageContextMenu
        message={message}
        row={{ kind: 'header', key: 'header', messageId: message.id }}
        canMutate={!readOnly}
      >
        <div
          data-message-id={message.id}
          data-testid="message"
          className="border p-8"
        >
          <MessageContext.Provider
            value={{
              id: message.id,
              canEdit: !readOnly,
              content: 'Fixture text',
            }}
          >
            {part?.type === 'text' ? (
              <EditableText part={part} index={0}>
                {part.text}
              </EditableText>
            ) : (
              'Fixture text'
            )}
          </MessageContext.Provider>
        </div>
      </MessageContextMenu>
      <button onClick={() => edit?.startEditing(message.id, 'Fixture text')}>
        Start editing
      </button>
      <output aria-label="Editing message">
        {edit?.editingMessageId ?? 'none'}
      </output>
      <output aria-label="Script actions">{actions}</output>
      <ScriptToolbarContent
        onScript={() => setActions((count) => count + 1)}
        onAction={() => setActions((count) => count + 1)}
      />
      <ScriptManager />
    </main>
  )
}

/** Exercises the production menus, script manager, and view navigation together. */
export function ScriptMenusFixture() {
  const [savedMarkdown, setSavedMarkdown] = useState('')
  return (
    <ConvexProvider client={client}>
      <ConvexQueryCacheProvider>
        <ChatMessagesProvider>
          <MessageEditProvider
            onEdit={(_id, content) => setSavedMarkdown(content)}
          >
            <Menus />
            <output aria-label="Saved message markdown">{savedMarkdown}</output>
          </MessageEditProvider>
        </ChatMessagesProvider>
      </ConvexQueryCacheProvider>
    </ConvexProvider>
  )
}
