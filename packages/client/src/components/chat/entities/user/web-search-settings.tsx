import {
  Combobox,
  Input,
  RippleButton,
  SearchableList,
  SettingsList,
  TooltipButton,
} from '@/components/ui'
import { generateId } from '@/lib/utils'
import {
  SUPPORTED_WEB_SEARCH_ENGINES,
  type SearchEngineId,
} from '@sb/core/types'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import type { Control } from 'react-hook-form'
import { Controller } from 'react-hook-form'

import type {
  SettingsFormValues,
  WebSearchInstanceFormValues,
} from './settings-schema'

type SearchSettingsProps = {
  control: Control<SettingsFormValues>
}

export function WebSearchSettings({ control }: SearchSettingsProps) {
  return (
    <SettingsList className="pb-4">
      <Controller
        control={control}
        name="webSearchInstances"
        render={({ field }) => (
          <SettingsList.Item
            label="Web search instances"
            description="Configure your web search instances. Currently supported: SearXNG."
            unclickable
            unhoverable
            orientation="vertical"
          >
            <WebSearchInstanceList
              instances={field.value}
              onChange={field.onChange}
            />
          </SettingsList.Item>
        )}
      />
    </SettingsList>
  )
}

type WebSearchInstanceListProps = {
  instances: WebSearchInstanceFormValues[]
  onChange: (instances: WebSearchInstanceFormValues[]) => void
}

type WebSearchInstanceItem = WebSearchInstanceFormValues & {
  id: string
  index: number
}

function WebSearchInstanceList({
  instances,
  onChange,
}: WebSearchInstanceListProps) {
  const items = instances.map((instance, index) => ({
    ...instance,
    id: instance._clientId ?? `${index}:${instance.engine}`,
    index,
  }))

  function handleAdd() {
    onChange([
      { engine: 'searxng', url: '', _clientId: generateId() },
      ...instances,
    ])
  }

  function handleChange(
    index: number,
    patch: Partial<WebSearchInstanceFormValues>,
  ) {
    onChange(
      instances.map((instance, i) =>
        i === index ? { ...instance, ...patch } : instance,
      ),
    )
  }

  function handleDelete(index: number) {
    onChange(instances.filter((_, i) => i !== index))
  }

  function handleMove(index: number, direction: -1 | 1) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= instances.length) return
    const next = [...instances]
    const current = next[index]
    if (!current || !next[nextIndex]) return
    next[index] = next[nextIndex]
    next[nextIndex] = current
    onChange(next)
  }

  return (
    <SearchableList<WebSearchInstanceItem>
      items={items}
      keys={(item) => item.id}
      fields={['engine', 'url']}
      pageSize={10}
      searchThreshold={5}
      searchPlaceholder="Search instances..."
      actions={
        <RippleButton
          type="button"
          size="sm"
          variant="input"
          onClick={handleAdd}
        >
          <PlusIcon />
          Add
        </RippleButton>
      }
      empty={() => (
        <div className="text-muted-foreground p-2 text-center text-xs">
          No instances configured
        </div>
      )}
      className="flex flex-col gap-2"
      itemProps={{ className: 'w-full' }}
      render={(item) => (
        <div className="bg-m3-surface-container-low border-input flex w-full items-center gap-1 rounded-full border py-1.5 pr-1.5 pl-4">
          <span className="text-muted-foreground w-5 shrink-0 text-xs">
            {item.index + 1}
          </span>
          <Combobox
            value={item.engine}
            onValueChange={(engine) =>
              handleChange(item.index, { engine: engine as SearchEngineId })
            }
            noDeselect
          >
            <Combobox.Trigger
              variant="stealth"
              size="sm"
              className="h-8 w-28 shrink-0 px-2"
            >
              <Combobox.DisplayValue>
                {(engine) =>
                  SUPPORTED_WEB_SEARCH_ENGINES.find((e) => e.id === engine)
                    ?.label ?? engine
                }
              </Combobox.DisplayValue>
            </Combobox.Trigger>
            <Combobox.Content align="start" className="w-40">
              <Combobox.List>
                {SUPPORTED_WEB_SEARCH_ENGINES.map((engine) => (
                  <Combobox.Item key={engine.id} value={engine.id}>
                    {engine.label}
                  </Combobox.Item>
                ))}
              </Combobox.List>
            </Combobox.Content>
          </Combobox>
          <Input
            value={item.url}
            placeholder="http://localhost:8080"
            onValueChange={(url) => handleChange(item.index, { url })}
            className="h-8 flex-1 border-0 bg-transparent px-2 shadow-none focus-visible:ring-0"
          />
          <TooltipButton
            type="button"
            tooltip="Move up"
            size="icon"
            variant="stealth"
            disabled={item.index === 0}
            className="text-muted-foreground hover:text-foreground"
            onClick={() => handleMove(item.index, -1)}
          >
            <ArrowUpIcon />
          </TooltipButton>
          <TooltipButton
            type="button"
            tooltip="Move down"
            size="icon"
            variant="stealth"
            disabled={item.index === instances.length - 1}
            className="text-muted-foreground hover:text-foreground"
            onClick={() => handleMove(item.index, 1)}
          >
            <ArrowDownIcon />
          </TooltipButton>
          <TooltipButton
            type="button"
            tooltip="Remove"
            size="icon"
            variant="stealth"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => handleDelete(item.index)}
          >
            <Trash2Icon />
          </TooltipButton>
        </div>
      )}
    />
  )
}
