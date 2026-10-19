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

/** Exercises the source-specific option in the shared directory picker. */
export function SkillSourceFixture() {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState(true)
  const [result, setResult] = useState('')
  return (
    <ConvexProvider client={client}>
      <button
        onClick={() => {
          setSource(true)
          setOpen(true)
        }}
      >
        Add source
      </button>
      <button
        onClick={() => {
          setSource(false)
          setOpen(true)
        }}
      >
        Choose agent home
      </button>
      <output>{result}</output>
      <WorkspacePickerDialog
        open={open}
        onOpenChange={setOpen}
        skillDiscovery={source}
        onSelect={(root, discoverSkills) =>
          setResult(JSON.stringify({ root, discoverSkills }))
        }
      />
    </ConvexProvider>
  )
}
