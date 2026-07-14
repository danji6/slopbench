import type { SessionMode } from '@sb/convex/types'

export type { SessionMode }

export type SessionModeDefinition = {
  id: SessionMode
  label: string
  description: string
}

/**
 * Ordered composer mode cycle. Adding a mode is one entry here plus
 * a literal in the backend `sessionModeValidator`.
 */
export const SESSION_MODES: readonly SessionModeDefinition[] = [
  {
    id: 'normal',
    label: 'Normal',
    description: 'The agent may use all of its tools.',
  },
  {
    id: 'plan',
    label: 'Plan',
    description:
      'The agent researches read-only and drafts a plan for approval.',
  },
]

export function resolveSessionMode(mode: SessionMode | undefined): SessionMode {
  return mode ?? 'normal'
}

export function getSessionModeDefinition(
  mode: SessionMode | undefined,
): SessionModeDefinition {
  const id = resolveSessionMode(mode)
  return SESSION_MODES.find((def) => def.id === id) ?? SESSION_MODES[0]!
}

export function nextSessionMode(mode: SessionMode | undefined): SessionMode {
  const index = SESSION_MODES.findIndex(
    (def) => def.id === resolveSessionMode(mode),
  )
  return SESSION_MODES[(index + 1) % SESSION_MODES.length]!.id
}

/** Toggle semantics for slash commands: `/plan` enters plan mode, again exits. */
export function toggledSessionMode(
  current: SessionMode | undefined,
  target: SessionMode,
): SessionMode {
  return resolveSessionMode(current) === target ? 'normal' : target
}
