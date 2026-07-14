import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

type ChatSearchContextValue = {
  /** Whether the search dialog is currently open. */
  isOpen: boolean
  /** Whether a session is mounted that can be searched. */
  available: boolean
  open: () => void
  close: () => void
}

const ChatSearchContext = createContext<ChatSearchContextValue | null>(null)

type InternalValue = ChatSearchContextValue & {
  setAvailable: (available: boolean) => void
}

const ChatSearchInternalContext = createContext<InternalValue | null>(null)

export function ChatSearchProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [available, setAvailable] = useState(false)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  const value = useMemo<InternalValue>(
    () => ({ isOpen, available, open, close, setAvailable }),
    [isOpen, available, open, close],
  )

  return (
    <ChatSearchContext.Provider value={value}>
      <ChatSearchInternalContext.Provider value={value}>
        {children}
      </ChatSearchInternalContext.Provider>
    </ChatSearchContext.Provider>
  )
}

export function useChatSearch(): ChatSearchContextValue {
  const ctx = useContext(ChatSearchContext)
  if (!ctx)
    throw new Error('useChatSearch must be used within ChatSearchProvider')
  return ctx
}

/**
 * Marks message search as available while the calling component is mounted, and
 * returns the dialog open state for it to render against.
 */
export function useChatSearchHost(): { isOpen: boolean; close: () => void } {
  const ctx = useContext(ChatSearchInternalContext)
  if (!ctx)
    throw new Error('useChatSearchHost must be used within ChatSearchProvider')
  const { setAvailable, isOpen, close } = ctx

  useEffect(() => {
    setAvailable(true)
    return () => {
      setAvailable(false)
      close()
    }
  }, [setAvailable, close])

  return { isOpen, close }
}
