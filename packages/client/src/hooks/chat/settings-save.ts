import { extractErrorMessage } from '@/lib/errors'
import { useRef, useState } from 'react'
import type { BaseSyntheticEvent } from 'react'
import type { FieldValues, UseFormReturn } from 'react-hook-form'
import { toast } from 'sonner'

export type SettingsSave = {
  /** Whether a save is in flight. */
  saving: boolean
  /** Persists and keeps the dialog open. Bind to the form's `onSubmit`. */
  apply: (event?: BaseSyntheticEvent) => Promise<void>
  /** Persists, then closes once it went through. */
  save: (event?: BaseSyntheticEvent) => Promise<void>
}

/** Runs a settings form's save one at a time. */
export function useSettingsSave<T extends FieldValues>(
  form: UseFormReturn<T>,
  persist: (values: T) => Promise<void>,
  close: () => void,
): SettingsSave {
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)

  /** @returns Whether this call is the one that ran. */
  async function run(values: T): Promise<boolean> {
    if (inFlight.current) return false
    inFlight.current = true
    setSaving(true)
    try {
      await persist(values)
      return true
    } catch (error) {
      toast.error(extractErrorMessage(error))
      return false
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return {
    saving,
    apply: (event) => form.handleSubmit(run)(event),
    save: (event) =>
      form.handleSubmit(async (values) => {
        if (await run(values)) close()
      })(event),
  }
}
