import { CollapsibleBlock } from '@/components/chat/messages/collapsible-block'
import { MessageListContext } from '@/components/chat/messages/message-list/message-list-context'
import { Dialog } from '@/components/ui/dialog'
import { SettingsCollapsible } from '@/components/ui/settings-collapsible'
import { Tabs } from '@/components/ui/tabs'
import '@/globals.css'
import { useEffect, useRef, useState } from 'react'

export function UiLayoutFixture() {
  const variant =
    new URLSearchParams(location.search).get('variant') === 'pill'
      ? 'pill'
      : 'hug'
  const [tab, setTab] = useState('tools')
  const [open, setOpen] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [lines, setLines] = useState(20)
  const scrollRef = useRef<HTMLElement | null>(document.documentElement)

  useEffect(() => {
    if (!streaming) return
    const interval = setInterval(() => setLines((value) => value + 1), 40)
    return () => clearInterval(interval)
  }, [streaming])

  return (
    <main className="bg-background text-foreground min-h-screen">
      <Dialog open={open} onOpenChange={setOpen}>
        <Dialog.Trigger>Settings</Dialog.Trigger>
        <Dialog.Content>
          <Dialog.Title>Layout settings</Dialog.Title>
          <Tabs value={tab} onValueChange={setTab} variant={variant}>
            <Tabs.List aria-label="Tool settings">
              <Tabs.Trigger value="tools">Tools</Tabs.Trigger>
              <Tabs.Trigger value="mcp">MCP</Tabs.Trigger>
              <Tabs.Trigger value="approvals">Approvals</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Panels>
              <Tabs.Content value="tools">Built-in tools</Tabs.Content>
              <Tabs.Content value="mcp">MCP tools</Tabs.Content>
              <Tabs.Content value="approvals">Approvals</Tabs.Content>
            </Tabs.Panels>
          </Tabs>
          <SettingsCollapsible label="Change password">
            Password settings
          </SettingsCollapsible>
        </Dialog.Content>
      </Dialog>
      <button onClick={() => setStreaming((value) => !value)}>
        Stream {streaming ? 'on' : 'off'}
      </button>
      <div style={{ height: 'calc(100vh - 240px)' }}>Transcript</div>
      <MessageListContext.Provider
        value={{
          scrollRef,
          bottomPadding: 80,
          topPadding: 12,
          releaseFollow: () => {},
          resumeFollow: () => {},
          onLayoutChange: () => {},
        }}
      >
        <CollapsibleBlock label="Thinking" fullWidth>
          <div>
            {Array.from({ length: lines }, (_, index) => (
              <p key={index} className="h-8">
                Reasoning line {index + 1}
              </p>
            ))}
          </div>
        </CollapsibleBlock>
      </MessageListContext.Provider>
      <div style={{ height: 80 }} />
    </main>
  )
}
