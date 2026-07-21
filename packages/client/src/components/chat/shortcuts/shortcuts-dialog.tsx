import { Dialog, T } from '@/components/ui'
import { useActiveSession } from '@/hooks/chat'

const isMac =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl'

type Shortcut = { keys: string[]; description: string }
type ShortcutItem = Shortcut | React.ReactNode
type ShortcutGroup = { title: string; items: ShortcutItem[] }

function isShortcut(item: ShortcutItem): item is Shortcut {
  return (
    typeof item === 'object' &&
    item !== null &&
    'keys' in item &&
    'description' in item
  )
}

function buildGroups(passiveSend: boolean): ShortcutGroup[] {
  const send = {
    keys: ['Shift', 'Enter'],
    description: 'Send the message',
  }
  const silent = {
    keys: [mod, 'Enter'],
    description: 'Send silently (with content)',
  }

  return [
    {
      title: 'Navigation',
      items: [
        { keys: ['Page Up'], description: 'Scroll the conversation up' },
        { keys: ['Page Down'], description: 'Scroll the conversation down' },
        { keys: ['Home'], description: 'Jump to the top' },
        { keys: ['End'], description: 'Jump to the bottom' },
        <>
          Hold <T.kbd>Alt</T.kbd> to navigate while the composer is focused.
        </>,
      ],
    },
    {
      title: 'Messages',
      items: [
        { keys: ['Esc'], description: 'Stop generating / cancel edit' },
        { keys: [mod, 'S'], description: 'Save (while editing)' },
        { keys: [mod, 'Shift', 'F'], description: 'Search messages' },
      ],
    },
    {
      title: 'Composer',
      items: [
        passiveSend ? { ...send, keys: silent.keys } : send,
        passiveSend ? { ...silent, keys: send.keys } : silent,
        {
          keys: ['Enter'],
          description: 'Continue with active agent (empty composer)',
        },
        { keys: ['↑'], description: 'Edit your last message (empty composer)' },
      ],
    },
  ]
}

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const session = useActiveSession()
  const groups = buildGroups(session?.settings?.passiveSend ?? false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content className="flex max-h-[calc(100svh-4rem)] flex-col sm:max-w-lg">
        <Dialog.Header>
          <Dialog.Title>Keyboard shortcuts</Dialog.Title>
        </Dialog.Header>
        <div className="flex flex-col gap-6 overflow-y-auto">
          {groups.map((group) => (
            <section key={group.title} className="flex flex-col gap-2">
              <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {group.title}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {group.items.map((item, index) =>
                  isShortcut(item) ? (
                    <li
                      key={index}
                      className="flex items-center justify-between gap-4"
                    >
                      <span className="text-sm">{item.description}</span>
                      <span className="flex shrink-0 items-center gap-0.5">
                        {item.keys.map((key, keyIndex) => (
                          <>
                            <T.kbd key={keyIndex}>{key}</T.kbd>
                            {keyIndex < item.keys.length - 1 && (
                              <span
                                key={keyIndex}
                                className="text-muted-foreground text-xs"
                              >
                                +
                              </span>
                            )}
                          </>
                        ))}
                      </span>
                    </li>
                  ) : (
                    <li key={index} className="text-muted-foreground text-xs">
                      {item}
                    </li>
                  ),
                )}
              </ul>
            </section>
          ))}
        </div>
      </Dialog.Content>
    </Dialog>
  )
}
