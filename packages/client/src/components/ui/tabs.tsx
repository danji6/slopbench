import { createUsableContext } from '@/hooks/context'
import { cn } from '@/lib/utils'
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import type { ButtonProps } from './button'
import { Button } from './button'
import { RippleButton } from './ripple-button'

const PANEL_OFFSET = 20

type Position = {
  left: number
  top: number
  right: number
  bottom: number
}

type Direction = 'left' | 'right'

type Variant = 'line' | 'pill'

interface TabsContextValue {
  currentValue: string | null
  previousValue: string | null
  direction: Direction | null
  isInitial: boolean
  tabOrder: string[]
  variant: Variant
  registerTab: (value: string) => void
}

const [TabsContext, useTabsContext] =
  createUsableContext<TabsContextValue>('Tabs')

function TabsRoot({
  className,
  orientation = 'horizontal',
  variant = 'line',
  children,
  value,
  onValueChange,
  ...props
}: TabsPrimitive.Root.Props & { variant?: Variant }) {
  const [tabOrder, setTabOrder] = useState<string[]>([])
  const [previousValue, setPreviousValue] = useState<string | null>(
    value ?? null,
  )
  const [isInitial, setIsInitial] = useState(value === undefined)

  const registerTab = (tabValue: string) => {
    if (!tabOrder.includes(tabValue)) {
      setTabOrder((prev) => [...prev, tabValue])
    }
  }

  const currentIndex = tabOrder.indexOf(value ?? '')
  const previousIndex = tabOrder.indexOf(previousValue ?? '')

  const direction: Direction | null =
    previousIndex === -1 ||
    currentIndex === -1 ||
    previousIndex === currentIndex
      ? null
      : previousIndex > currentIndex
        ? 'left'
        : 'right'

  const handleValueChange = (
    newValue: string,
    eventDetails: TabsPrimitive.Root.ChangeEventDetails,
  ) => {
    setPreviousValue(value ?? null)
    setIsInitial(false)
    onValueChange?.(newValue, eventDetails)
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      setPreviousValue(value ?? null)
      setIsInitial(false)
    }, 50)
    return () => clearTimeout(timer)
  }, [value])

  return (
    <TabsContext.Provider
      value={{
        currentValue: value ?? null,
        previousValue,
        direction: isInitial ? null : direction,
        isInitial,
        tabOrder,
        variant,
        registerTab,
      }}
    >
      <TabsPrimitive.Root
        data-slot="tabs"
        data-orientation={orientation}
        className={cn(
          variant === 'pill'
            ? 'flex w-full flex-col items-center gap-4'
            : 'group/tabs flex gap-2 data-horizontal:flex-col',
          className,
        )}
        value={value}
        onValueChange={handleValueChange}
        {...props}
      >
        {children}
      </TabsPrimitive.Root>
    </TabsContext.Provider>
  )
}

function TabsList({ className, children, ...props }: TabsPrimitive.List.Props) {
  const { variant } = useTabsContext()
  const listRef = useRef<HTMLDivElement>(null)

  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'text-muted-foreground relative inline-flex items-center justify-center gap-1',
        variant === 'pill'
          ? 'bg-muted size-fit rounded-full p-2'
          : 'border-input group/tabs-list w-full rounded-none border-b px-1.5 group-data-horizontal/tabs:h-12 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col',
        className,
      )}
      ref={listRef}
      {...props}
    >
      <TabsIndicator listRef={listRef} />
      {children}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({ className, value, ...props }: TabsPrimitive.Tab.Props) {
  const { variant, registerTab } = useTabsContext()

  useEffect(() => {
    if (value) registerTab(value)
  }, [value, registerTab])

  if (variant === 'pill') {
    return (
      <TabsPrimitive.Tab
        data-slot="tabs-trigger"
        data-value={value}
        render={(renderProps, { active }) => (
          <Button
            variant={active ? 'plain' : 'stealth'}
            {...(renderProps as ButtonProps)}
          />
        )}
        className={cn(
          "z-10 inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent text-sm font-medium whitespace-nowrap focus-visible:ring-1 focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          'data-active:text-m3-on-secondary data-active:bg-transparent',
          '[--td:230ms] data-active:[--td:0ms]',
          '[transition:color_230ms_ease_var(--td),background-color_var(--td)]!',
          'h-10 rounded-full border-0 px-5 py-2 hover:ring-0',
          className,
        )}
        value={value}
        {...props}
      />
    )
  }

  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      data-value={value}
      render={<RippleButton variant="surface" />}
      className={cn(
        'data-active:bg-m3-surface-container-high border-input/80 size-full flex-1 rounded-none rounded-t-lg border border-b-0 px-3 py-1.5 text-sm font-medium transition-colors data-active:shadow-none',
        className,
      )}
      value={value}
      {...props}
    />
  )
}

function TabsIndicator({
  listRef,
}: {
  listRef: React.RefObject<HTMLDivElement | null>
}) {
  const { currentValue, direction, isInitial, variant } = useTabsContext()
  const [position, setPosition] = useState<Position>({
    left: 4,
    top: 4,
    right: 4,
    bottom: 4,
  })
  const [pendingPosition, setPendingPosition] = useState<Position | null>(null)

  useEffect(() => {
    const list = listRef.current
    if (!list || !currentValue) return

    const tabs = list.querySelectorAll('[data-slot="tabs-trigger"]')
    const activeIndex = Array.from(tabs).findIndex(
      (tab) => tab.getAttribute('data-value') === currentValue,
    )

    if (activeIndex === -1) return

    const activeTab = tabs[activeIndex] as HTMLElement

    const newPosition: Position =
      variant === 'pill'
        ? {
            left: activeTab.offsetLeft,
            top: activeTab.offsetTop,
            right:
              list.offsetWidth - activeTab.offsetLeft - activeTab.offsetWidth,
            bottom:
              list.offsetHeight - activeTab.offsetTop - activeTab.offsetHeight,
          }
        : {
            left: activeTab.offsetLeft,
            top: list.offsetHeight - 3,
            right:
              list.offsetWidth - activeTab.offsetLeft - activeTab.offsetWidth,
            bottom: 0,
          }

    if (isInitial) {
      setPosition(newPosition)
    } else {
      setPendingPosition(newPosition)
    }
  }, [currentValue, isInitial, listRef, variant])

  const getTransitionDelays = () => {
    const STAGGER_DELAY = variant === 'pill' ? 0.2 : 0.08
    const DURATION = variant === 'pill' ? 0.15 : 0.2

    const movingLeft = direction === 'left'
    const movingRight = direction === 'right'

    return {
      left: movingRight ? STAGGER_DELAY : 0,
      right: movingLeft ? STAGGER_DELAY : 0,
      top: 0,
      bottom: 0,
      duration: direction ? DURATION : 0,
    }
  }

  const handleAnimationComplete = () => {
    if (pendingPosition) {
      setPosition(pendingPosition)
      setPendingPosition(null)
    }
  }

  const activePosition = pendingPosition ?? position
  const { duration, ...delays } = getTransitionDelays()

  return (
    <TabsPrimitive.Indicator
      render={() => (
        <motion.span
          className={cn(
            'absolute',
            variant === 'pill'
              ? 'bg-m3-secondary rounded-full'
              : 'bg-primary pointer-events-none z-10',
          )}
          animate={activePosition}
          initial={false}
          transition={{
            left: {
              duration,
              ease: [0.4, 0, 0.2, 1],
              delay: delays.left,
            },
            right: {
              duration,
              ease: [0.4, 0, 0.2, 1],
              delay: delays.right,
            },
            top: {
              duration,
              ease: [0.4, 0, 0.2, 1],
              delay: delays.top,
            },
            bottom: {
              duration,
              ease: [0.4, 0, 0.2, 1],
              delay: delays.bottom,
            },
          }}
          onAnimationComplete={handleAnimationComplete}
        />
      )}
    />
  )
}

function TabsPanels({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="tabs-panels"
      className={cn('relative flex min-h-0 flex-1 flex-col', className)}
      {...props}
    />
  )
}

function TabsContent({
  className,
  children,
  value,
  ...props
}: TabsPrimitive.Panel.Props) {
  const { currentValue, tabOrder } = useTabsContext()
  const isActive = currentValue === value

  const nextIndex = tabOrder.indexOf(value ?? '')
  const currentIndex = tabOrder.indexOf(currentValue ?? '')
  const restingOffset =
    nextIndex === -1 || currentIndex === -1 || nextIndex === currentIndex
      ? 0
      : nextIndex < currentIndex
        ? -PANEL_OFFSET
        : PANEL_OFFSET

  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn(
        'text-sm outline-none',
        isActive ? 'relative flex-1' : 'absolute inset-x-0 top-0',
        className,
      )}
      value={value}
      keepMounted
      render={({
        onAnimationStart: _onAnimationStart,
        onAnimationEnd: _onAnimationEnd,
        onDrag: _onDrag,
        onDragStart: _onDragStart,
        onDragEnd: _onDragEnd,
        ...renderProps
      }) => (
        <motion.div
          {...renderProps}
          initial={{ opacity: 0 }}
          animate={
            isActive ? { x: 0, opacity: 1 } : { x: restingOffset, opacity: 0 }
          }
          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
        >
          {children}
        </motion.div>
      )}
      {...props}
    />
  )
}

export const Tabs = Object.assign(TabsRoot, {
  List: TabsList,
  Trigger: TabsTrigger,
  Panels: TabsPanels,
  Content: TabsContent,
  Indicator: TabsIndicator,
})

export { useTabsContext }
