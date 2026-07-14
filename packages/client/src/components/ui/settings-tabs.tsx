import { useBreakpoint } from '@/hooks'
import { createUsableContext } from '@/hooks/context'
import { cn } from '@/lib/utils'
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import { RippleButton, type RippleButtonProps } from './ripple-button'

interface SettingsTabsContextValue {
  value: string | null
}

const [SettingsTabsContext, useSettingsTabsContext] =
  createUsableContext<SettingsTabsContextValue>('SettingsTabs')

function SettingsTabsRoot({
  className,
  children,
  value: controlledValue,
  defaultValue,
  onValueChange,
  ...props
}: TabsPrimitive.Root.Props) {
  const isControlled = controlledValue !== undefined
  const [uncontrolledValue, setUncontrolledValue] = useState<string | null>(
    (defaultValue as string) ?? null,
  )

  const currentValue = isControlled
    ? (controlledValue as string)
    : uncontrolledValue

  const handleValueChange = (
    newValue: string,
    eventDetails: TabsPrimitive.Root.ChangeEventDetails,
  ) => {
    if (!isControlled) setUncontrolledValue(newValue)
    onValueChange?.(newValue, eventDetails)
  }

  return (
    <SettingsTabsContext.Provider value={{ value: currentValue }}>
      <TabsPrimitive.Root
        data-slot="settings-tabs"
        className={cn('flex flex-col md:flex-row', className)}
        value={controlledValue}
        defaultValue={defaultValue}
        onValueChange={handleValueChange}
        {...props}
      >
        {children}
      </TabsPrimitive.Root>
    </SettingsTabsContext.Provider>
  )
}

type IndicatorPos = { top: number; height: number }

function SettingsTabsIndicator({
  listRef,
}: {
  listRef: React.RefObject<HTMLDivElement | null>
}) {
  const { value } = useSettingsTabsContext()
  const [pos, setPos] = useState<IndicatorPos | null>(null)

  useEffect(() => {
    if (!listRef.current || !value) return

    const activeTab = listRef.current.querySelector(
      '[data-slot="settings-tabs-trigger"][data-active]',
    ) as HTMLElement | null
    if (!activeTab) return

    setPos({ top: activeTab.offsetTop, height: activeTab.offsetHeight })
  }, [value, listRef])

  if (!pos) return null

  return (
    <motion.div
      className="bg-primary/20 pointer-events-none absolute inset-x-2 rounded-full"
      animate={{ top: pos.top, height: pos.height }}
      initial={false}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
    />
  )
}

function SettingsTabsList({
  className,
  children,
  ...props
}: TabsPrimitive.List.Props) {
  const isMobile = useBreakpoint('md')
  const listRef = useRef<HTMLDivElement>(null)

  return (
    <TabsPrimitive.List
      data-slot="settings-tabs-list"
      className={cn(
        'relative flex shrink-0 gap-1 p-2',
        isMobile
          ? 'order-last flex-row flex-wrap justify-around border-t'
          : 'flex-col border-r',
        className,
      )}
      ref={listRef}
      {...props}
    >
      {!isMobile && <SettingsTabsIndicator listRef={listRef} />}
      {children}
    </TabsPrimitive.List>
  )
}

function SettingsTabsTrigger({
  className,
  value,
  icon,
  children,
  ...props
}: TabsPrimitive.Tab.Props & { icon?: React.ReactNode }) {
  const isMobile = useBreakpoint('md')

  return (
    <TabsPrimitive.Tab
      data-slot="settings-tabs-trigger"
      render={(renderProps, { active }) => (
        <RippleButton
          variant={active ? 'plain' : 'stealth'}
          size={isMobile ? 'icon' : 'default'}
          {...(renderProps as RippleButtonProps)}
        />
      )}
      className={cn(
        'text-muted-foreground data-active:text-primary relative z-10 flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors',
        isMobile ? 'flex-1 justify-center' : 'w-full justify-start',
        className,
      )}
      value={value}
      {...props}
    >
      {icon}
      {!isMobile && children}
    </TabsPrimitive.Tab>
  )
}

function SettingsTabsContent({
  className,
  title,
  children,
  ...props
}: TabsPrimitive.Panel.Props & { title?: string }) {
  return (
    <TabsPrimitive.Panel
      data-slot="settings-tabs-content"
      className={cn('flex-1 overflow-y-auto outline-none', className)}
      {...props}
    >
      {title && (
        <h2 className="px-6 pt-4 pb-2 text-lg font-semibold">{title}</h2>
      )}
      {children}
    </TabsPrimitive.Panel>
  )
}

export const SettingsTabs = Object.assign(SettingsTabsRoot, {
  List: SettingsTabsList,
  Trigger: SettingsTabsTrigger,
  Content: SettingsTabsContent,
})
