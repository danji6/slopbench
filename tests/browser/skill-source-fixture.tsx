import { WorkspacePickerDialog } from '@/components/chat/sessions/workspace-picker-dialog'
import '@/globals.css'
import { ConvexProvider, type ConvexReactClient } from 'convex/react'
import { useState } from 'react'

const client = {
  action: async (_reference: unknown, args: { path?: string }) => ({
    path: args.path ?? '/projects',
    parent: '/',
    entries: [],
  }),
} as unknown as ConvexReactClient

/** Exercises the shared directory picker for sources and agent homes. */
export function SkillSourceFixture() {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState('')
  return (
    <ConvexProvider client={client}>
      <button
        onClick={() => {
          setOpen(true)
        }}
      >
        Add source
      </button>
      <button
        onClick={() => {
          setOpen(true)
        }}
      >
        Choose agent home
      </button>
      <output>{result}</output>
      <WorkspacePickerDialog
        open={open}
        onOpenChange={setOpen}
        onSelect={(root) => setResult(JSON.stringify({ root }))}
      />
    </ConvexProvider>
  )
}
