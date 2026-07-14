import { Popover } from '@/components/ui/popover'
import { ProgressCircle } from '@/components/ui/progress-circle'
import { useActiveModel, useActiveSession, useChatMetadata } from '@/hooks/chat'
import type { UsageTotals } from '@/lib/chat/types'
import { abbreviateNumber, cn } from '@/lib/utils'
import { useMemo } from 'react'

export function TokenWidget({ className }: { className?: string }) {
  const { lastRequest, session, context } = useTokenData()

  return (
    <Popover>
      <Popover.Trigger
        className={cn(
          'focus-visible:ring-ring flex h-full cursor-pointer items-center justify-center rounded-full p-1 outline-0 transition-colors focus-visible:ring-1',
          className,
        )}
        aria-label={`Context: ${context.percentage}%`}
      >
        <ProgressCircle value={context.value} max={context.max ?? Infinity} />
      </Popover.Trigger>
      <Popover.Content align="end" className="w-64">
        <Popover.Header>
          <Popover.Title>Token usage</Popover.Title>
          {context.modelLabel && (
            <Popover.Description>{context.modelLabel}</Popover.Description>
          )}
        </Popover.Header>

        <ContextMeter
          value={context.value}
          max={context.max}
          percentage={context.percentage}
        />

        <UsageSection title="Last request" usage={lastRequest} />
        <UsageSection title="This session" usage={session} />
      </Popover.Content>
    </Popover>
  )
}

function ContextMeter({
  value,
  max,
  percentage,
}: {
  value: number
  max?: number
  percentage: number
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Row label="Context">
        <span className="text-muted-foreground">
          {abbreviateNumber(value)} / {max ? abbreviateNumber(max) : '∞'}
        </span>
      </Row>
      <div className="bg-input/60 h-1.5 w-full overflow-hidden rounded-full">
        <div
          className="bg-primary h-full rounded-full transition-all duration-300 ease-out"
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
    </div>
  )
}

function UsageSection({
  title,
  usage,
}: {
  title: string
  usage: UsageTotals | undefined
}) {
  if (!usage) return null

  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0
  const total = usage.totalTokens ?? input + output

  return (
    <div className="border-foreground/10 flex flex-col gap-1 border-t pt-2">
      <div className="text-muted-foreground text-xs font-medium">{title}</div>
      <Row label="Input">{abbreviateNumber(input)}</Row>
      <Row label="Output">{abbreviateNumber(output)}</Row>
      <Row label="Total">{abbreviateNumber(total)}</Row>
    </div>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  )
}

function useTokenData() {
  const metadata = useChatMetadata()
  const session = useActiveSession()
  const model = useActiveModel()

  return useMemo(() => {
    const lastRequest = metadata?.usage
    const sessionUsage = session?.metadata?.usage
    const max = model?.contextWindow
    const value = lastRequest?.totalTokens ?? 0
    const percentage = Math.round(max ? (value / max) * 100 : 0)

    return {
      lastRequest,
      session: sessionUsage,
      context: {
        value,
        max,
        percentage,
        modelLabel: model?.label ?? model?.id,
      },
    }
  }, [metadata, session, model])
}
