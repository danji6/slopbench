import { RippleButton, type RippleButtonProps } from '@/components/ui'
import { cn } from '@/lib/utils'
import { SearchIcon } from 'lucide-react'

import { useChatSearch } from './chat-search-context'

export type SearchHistoryButtonProps = RippleButtonProps & {
  collapsed?: boolean
}

export function SearchHistoryButton({
  collapsed = false,
  ...props
}: SearchHistoryButtonProps) {
  const { open } = useChatSearch()

  return (
    <RippleButton
      {...props}
      onClick={open}
      variant="stealth"
      size={!collapsed ? 'default' : 'icon'}
      className={cn(
        'text-muted-foreground rounded-full',
        !collapsed &&
          'focus-visible:border-ring h-11 w-full justify-center rounded-md font-bold focus-visible:border focus-visible:ring-0',
      )}
    >
      <SearchIcon />
      {!collapsed && <span>Search</span>}
    </RippleButton>
  )
}
