import { cn } from '@/lib/utils'
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  type Modifier,
  PointerSensor,
  TouchSensor,
  type UniqueIdentifier,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { type HTMLMotionProps, motion } from 'motion/react'

const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
})

export type SortableHandleProps = {
  style?: React.CSSProperties
} & Record<string, unknown>

export type SortableListProps<T> = HTMLMotionProps<'ul'> & {
  items: T[]
  keys: (item: T) => string | number
  render: (
    item: T,
    index: number,
    handleProps: SortableHandleProps,
  ) => React.ReactNode
  onReorder?: (items: T[]) => void
  className?: string
  itemProps?: HTMLMotionProps<'li'>
}

export type SortableItemProps<T> = {
  item: T
  index: number
  render: (
    item: T,
    index: number,
    handleProps: SortableHandleProps,
  ) => React.ReactNode
} & HTMLMotionProps<'li'>

export function SortableList<T>({
  items,
  keys,
  render,
  onReorder,
  className,
  itemProps,
  ...props
}: SortableListProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = items.findIndex((item) => keys(item) === active.id)
    const newIndex = items.findIndex((item) => keys(item) === over.id)

    if (oldIndex !== -1 && newIndex !== -1) {
      const newItems = arrayMove(items, oldIndex, newIndex)
      onReorder?.(newItems)
    }
  }

  const itemIds = items.map(keys)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <motion.ul
          data-slot="sortable-list"
          className={cn('relative', className)}
          {...props}
        >
          {items.map((item, index) => (
            <SortableListItem
              key={keys(item)}
              id={keys(item)}
              item={item}
              index={index}
              render={render}
              {...itemProps}
            />
          ))}
        </motion.ul>
      </SortableContext>
    </DndContext>
  )
}

function SortableListItem<T>({
  id,
  item,
  index,
  render,
  className,
  ...props
}: {
  id: UniqueIdentifier
} & Omit<SortableItemProps<T>, 'id'>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
  }

  const handleProps: SortableHandleProps = {
    ...(listeners ?? {}),
    ...(attributes ?? {}),
    style: {
      touchAction: 'none',
      cursor: isDragging ? 'grabbing' : 'grab',
    },
  }

  return (
    <motion.li
      ref={setNodeRef}
      style={style}
      data-slot="sortable-list-item"
      className={cn('w-full', isDragging && 'z-50 opacity-70', className)}
      {...props}
    >
      {render(item, index, handleProps)}
    </motion.li>
  )
}
