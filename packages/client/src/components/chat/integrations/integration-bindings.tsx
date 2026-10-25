import {
  Input,
  RippleButton,
  SettingsCollapsible,
  SettingsSwitch,
  TrashButton,
} from '@/components/ui'
import { useIntegrationBindings } from '@/hooks/chat/integration-bindings'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useState } from 'react'

import { IntegrationFeedback } from './integration-feedback'

type Server = NonNullable<
  ReturnType<typeof useIntegrationBindings>['servers']
>[number]

type Control = Omit<ReturnType<typeof useIntegrationBindings>, 'servers'>

export function IntegrationBindings({
  integrationId,
}: {
  integrationId: Id<'integrations'>
}) {
  const controls = useIntegrationBindings(integrationId)
  if (!controls.servers?.length) return null
  return (
    <SettingsCollapsible label="Server settings" contentClassName="gap-3">
      {controls.servers.map((server) => (
        <ServerBindings key={server._id} server={server} {...controls} />
      ))}
    </SettingsCollapsible>
  )
}

function ServerBindings({
  server,
  busy,
  feedback,
  save,
}: Control & { server: Server }) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const local = server.transport === 'stdio'
  return (
    <section
      className="space-y-2 rounded-xl border p-3"
      aria-label={`${server.name} server settings`}
    >
      <SettingsSwitch
        label={server.name}
        reserveActionSpace={false}
        checked={server.enabled}
        disabled={busy}
        onCheckedChange={(enabled) =>
          void save({ serverId: server._id, enabled })
        }
      />
      {local && (
        <Input
          size="sm"
          aria-label={`${server.name} environment variable`}
          placeholder="Environment variable name"
          value={name}
          onValueChange={setName}
        />
      )}
      <Input
        size="sm"
        type="password"
        aria-label={`${server.name} credential value`}
        placeholder={
          local
            ? 'Environment value (kept secret)'
            : server.hasKey
              ? 'Bearer credential (already set)'
              : 'Bearer credential (optional)'
        }
        value={value}
        onValueChange={setValue}
      />
      <RippleButton
        size="sm"
        variant="input"
        disabled={busy || !value || (local && !name.trim())}
        onClick={async () => {
          const saved = await save({
            serverId: server._id,
            enabled: server.enabled,
            ...(local
              ? { secretEnv: { [name.trim()]: value } }
              : { apiKey: value }),
          })
          if (saved) setValue('')
        }}
      >
        Save credential
      </RippleButton>
      {local
        ? server.secretEnvNames.map((binding) => (
            <div
              key={binding}
              className="flex items-center justify-between text-xs"
            >
              <span>{binding} (value hidden)</span>
              <TrashButton
                aria-label={`Remove ${binding} binding`}
                disabled={busy}
                onClick={() =>
                  void save({
                    serverId: server._id,
                    enabled: server.enabled,
                    secretEnv: { [binding]: '' },
                  })
                }
              />
            </div>
          ))
        : server.hasKey && (
            <TrashButton
              aria-label={`Remove ${server.name} bearer credential`}
              disabled={busy}
              onClick={() =>
                void save({
                  serverId: server._id,
                  enabled: server.enabled,
                  apiKey: '',
                })
              }
            />
          )}
      <IntegrationFeedback
        feedback={feedback?.serverId === server._id ? feedback : undefined}
      />
    </section>
  )
}
