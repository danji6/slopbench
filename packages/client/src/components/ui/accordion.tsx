import { cn } from '@/lib/utils'
import { Accordion as AccordionPrimitive } from '@base-ui/react/accordion'
import { AnimatePresence, type HTMLMotionProps, motion } from 'framer-motion'

import { RippleButton, type RippleButtonProps } from './ripple-button'

function AccordionRoot({ className, ...props }: AccordionPrimitive.Root.Props) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn('flex w-full flex-col', className)}
      {...props}
    />
  )
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn('group/accordion-item', className)}
      {...props}
    />
  )
}

function AccordionTrigger({
  className,
  children,
  ...props
}: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        render={(triggerProps, state) => {
          return (
            <RippleButton
              variant="surface"
              size="lg"
              {...(triggerProps as RippleButtonProps)}
            >
              {children}
              <AccordionIcon isExpanded={state.open} className="ml-auto" />
            </RippleButton>
          )
        }}
        data-slot="accordion-trigger"
        className={cn(
          'focus-visible:ring-ring **:data-[slot=accordion-trigger-icon]:text-muted-foreground group/accordion-trigger relative isolate flex flex-1 items-center justify-between overflow-hidden px-5 py-4 text-lg font-bold outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:opacity-50',
          'rounded-none border group-first/accordion-item:rounded-t-xl group-last/accordion-item:rounded-b-xl group-data-open/accordion-item:rounded-b-none! group-[:not(:first-child)]/accordion-item:border-t-0',
          className,
        )}
        {...props}
      />
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({
  className,
  children,
  ...props
}: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      keepMounted
      {...props}
      render={(panelProps: React.ComponentProps<'div'>, state) => {
        const { style, ...rest } = panelProps

        return (
          <AnimatePresence initial={false}>
            {state.open && (
              <motion.div
                {...(rest as HTMLMotionProps<'div'>)}
                style={{ ...style, display: 'block' }}
                initial="closed"
                animate="open"
                exit="closed"
                variants={{
                  open: {
                    height: 'auto',
                    filter: 'blur(0)',
                    opacity: 1,
                  },
                  closed: {
                    height: 0,
                    filter: 'blur(12px)',
                    opacity: 0,
                  },
                }}
                transition={{
                  height: {
                    duration: 0.3,
                    ease: [0.4, 0, 0.2, 1],
                  },
                  opacity: {
                    duration: 0.25,
                    ease: 'linear',
                  },
                  filter: {
                    duration: 0.2,
                    ease: 'linear',
                  },
                }}
                className="overflow-hidden"
              >
                <div
                  className={cn(
                    '[&_a]:hover:text-foreground border border-t-0 pt-2 pb-4 group-last/accordion-item:rounded-b-xl [&_a]:underline [&_a]:underline-offset-3 [&_p:not(:last-child)]:mb-4',
                    className,
                  )}
                >
                  {children}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )
      }}
    />
  )
}

function AccordionIcon({
  isExpanded,
  ...props
}: {
  isExpanded: boolean
} & React.SVGProps<SVGSVGElement>) {
  const chevronPath = 'M 6 10 L 12 16 L 18 10'
  const minusPath = 'M 6 12 L 12 12 L 18 12'

  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <title>Expand</title>
      <motion.path
        d={isExpanded ? minusPath : chevronPath}
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={{ d: isExpanded ? minusPath : chevronPath }}
        transition={{
          duration: 0.3,
          ease: 'easeInOut',
        }}
      />
    </svg>
  )
}

export const Accordion = Object.assign(AccordionRoot, {
  Item: AccordionItem,
  Trigger: AccordionTrigger,
  Content: AccordionContent,
  Icon: AccordionIcon,
})
