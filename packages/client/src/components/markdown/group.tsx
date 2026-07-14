import { cn } from '@/lib/utils'
import { toDashCase } from '@sb/core/utils/strings'
import type React from 'react'
import { useMemo } from 'react'

import { Accordion } from '../ui'
import { MarkdownCode } from './code'
import { useMarkdown } from './context'

export function MarkdownGroup({
  items,
  type,
  direction = 'col',
  children,
}: {
  items?: string
  type: 'code' | 'media'
  direction?: 'row' | 'col'
  children?: React.ReactNode
}) {
  return type === 'media' ? (
    <MarkdownMediaGroup direction={direction}>{children}</MarkdownMediaGroup>
  ) : (
    <MarkdownCodeGroup items={items} />
  )
}

export function MarkdownMediaGroup({
  direction = 'col',
  children,
}: {
  direction?: 'row' | 'col'
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex w-full items-center justify-center gap-6 not-first:mt-6',
        direction === 'row' ? 'flex-row flex-wrap' : 'flex-col',
      )}
    >
      {children}
    </div>
  )
}

export function MarkdownCodeGroup({ items }: { items?: string }) {
  const { mdKey } = useMarkdown()

  const groupTag = useMemo(() => {
    if (!items) return 'empty'
    let hash = 0
    for (let i = 0; i < items.length; i++) {
      hash = (hash << 5) - hash + items.charCodeAt(i)
      hash |= 0
    }
    return Math.abs(hash).toString(36)
  }, [items])

  let parsedItems: { lang?: string; value: string; title?: string }[]
  try {
    parsedItems = JSON.parse(items || '[]')
  } catch {
    return null
  }

  return (
    <Accordion
      defaultValue={[1]}
      className="mx-auto mt-6 max-w-5xl not-first:mt-6"
    >
      {parsedItems.map((item, index) => {
        const key = toDashCase(
          `${mdKey}.code.${groupTag}.${index}.${item.title || 'untitled'}`,
        )
        const val = index + 1

        return (
          <Accordion.Item value={val} key={key}>
            <Accordion.Trigger>{item.title || null}</Accordion.Trigger>
            <Accordion.Content className="p-0">
              <MarkdownCode text={item.value} language={item.lang} />
            </Accordion.Content>
          </Accordion.Item>
        )
      })}
    </Accordion>
  )
}
