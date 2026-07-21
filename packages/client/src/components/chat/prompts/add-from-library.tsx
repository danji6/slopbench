import { Combobox } from '@/components/ui'
import { BookmarkIcon } from 'lucide-react'

const LIBRARY_SEARCH_THRESHOLD = 3

export type LibraryEntry = { id: string; name: string }

type AddFromLibraryProps = {
  items: LibraryEntry[]
  onSelect: (id: string) => void
  searchPlaceholder?: string
  emptyText?: string
}

/** Picks an item from the user's library to reference from an agent. */
export function AddFromLibrary({
  items,
  onSelect,
  searchPlaceholder = 'Search prompts...',
  emptyText = 'No prompts found.',
}: AddFromLibraryProps) {
  const showSearch = items.length > LIBRARY_SEARCH_THRESHOLD

  return (
    <Combobox onValueChange={onSelect}>
      <Combobox.Trigger
        variant="input"
        size="sm"
        className="text-m3-secondary w-auto"
        disabled={items.length === 0}
      >
        <BookmarkIcon className="size-4" />
        Library
      </Combobox.Trigger>
      <Combobox.Content className="min-w-52">
        {showSearch && <Combobox.Search placeholder={searchPlaceholder} />}
        <Combobox.List>
          <Combobox.Empty>{emptyText}</Combobox.Empty>
          {items.map((item) => (
            <Combobox.Item key={item.id} value={item.id}>
              {item.name}
            </Combobox.Item>
          ))}
        </Combobox.List>
      </Combobox.Content>
    </Combobox>
  )
}
