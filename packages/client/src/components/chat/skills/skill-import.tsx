import { WorkspacePickerDialog } from '@/components/chat/sessions/workspace-picker-dialog'
import { AlertMessage, Input, RippleButton } from '@/components/ui'
import { useFormDraft } from '@/hooks/chat/form-draft'
import type { useAgentFileOperation } from '@/hooks/chat/skills'
import { extractErrorMessage } from '@/lib/errors'
import { api } from '@sb/convex/_generated/api'
import { skillUploadHeader } from '@sb/core/skills/upload'
import { useMutation } from 'convex/react'
import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'

export function SkillImport({
  operation,
}: {
  operation: ReturnType<typeof useAgentFileOperation>
}) {
  const form = useForm({ defaultValues: { source: '' } })
  const source = useWatch({ control: form.control, name: 'source' })
  const draft = useFormDraft('skill-import', form, 'this skill import')
  const initialized = useRef(false)

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      draft.sync({ source: '' })
    }
  }, [draft])

  const [browsing, setBrowsing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string>()
  const fileInput = useRef<HTMLInputElement>(null)
  const generateUploadUrl = useMutation(api.skills.generateUploadUrl)
  const recordUpload = useMutation(api.skills.recordUpload)

  async function upload(file: File) {
    setUploading(true)
    setError(undefined)
    try {
      const { url, ticket, uploadId } = await generateUploadUrl({})
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: new Blob([skillUploadHeader(ticket), file]),
      })
      if (!response.ok) {
        throw new Error('Skill upload failed')
      }
      const { storageId } = await response.json()
      await recordUpload({ uploadId, storageId })
      await operation.run({ kind: 'install', storageId })
    } catch (error) {
      setError(extractErrorMessage(error))
    } finally {
      setUploading(false)
    }
  }

  const busy = operation.busy || uploading

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Install all skills found recursively in a directory or ZIP. Each skill’s
        resources and binaries are preserved. Existing names are skipped.
      </p>
      <Input
        aria-label="Skill directory on the sidecar"
        placeholder="Directory on the sidecar…"
        {...form.register('source')}
      />
      <div className="flex flex-wrap gap-2">
        <RippleButton
          size="sm"
          variant="input"
          disabled={busy}
          onClick={() => setBrowsing(true)}
        >
          Browse
        </RippleButton>
        <RippleButton
          size="sm"
          variant="input"
          disabled={busy || !source.trim()}
          onClick={() =>
            void operation.run({
              kind: 'install',
              source: form.getValues('source').trim(),
            })
          }
        >
          Install directory
        </RippleButton>
        <RippleButton
          size="sm"
          variant="input"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? 'Uploading…' : 'Upload ZIP'}
        </RippleButton>
      </div>
      {error && <AlertMessage dismissible={false}>{error}</AlertMessage>}
      <input
        ref={fileInput}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) {
            void upload(file)
          }
          event.target.value = ''
        }}
      />
      <WorkspacePickerDialog
        open={browsing}
        onOpenChange={setBrowsing}
        title="Select a directory containing skills"
        onSelect={(source) =>
          form.setValue('source', source, { shouldDirty: true })
        }
      />
    </div>
  )
}
