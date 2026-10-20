import { PromptContentEditor } from '@/components/chat/prompts/prompt-content-editor'
import { ConfirmDialog, Dialog, RippleButton } from '@/components/ui'
import { formatMarkdown } from '@/lib/markdown/format'
import { DEFAULT_TITLE_SYSTEM_PROMPT } from '@sb/core/title-generation'
import { useState } from 'react'

type TitlePromptEditorProps = {
  value: string
  onSave: (value: string) => void
  onClose: () => void
}

export function TitlePromptEditor({
  value,
  onSave,
  onClose,
}: TitlePromptEditorProps) {
  const [content, setContent] = useState(value)
  // Compare edits with the editor's serialization as well as the stored text
  const [baseline, setBaseline] = useState(value)
  const formattedContent = formatMarkdown(content)
  const savedContent = formatMarkdown(value)
  const unchanged = formattedContent === savedContent || formattedContent === baseline // prettier-ignore
  const isDefault =
    formattedContent === DEFAULT_TITLE_SYSTEM_PROMPT ||
    (savedContent === DEFAULT_TITLE_SYSTEM_PROMPT && unchanged)

  function save() {
    if (!unchanged) onSave(formattedContent)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content
        showCloseButton={false}
        className="grid h-[calc(100svh-2rem)] max-h-180 max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden"
      >
        <Dialog.Header>
          <Dialog.Title>Title prompt</Dialog.Title>
        </Dialog.Header>
        <PromptContentEditor
          value={content}
          onChange={setContent}
          onBaseline={setBaseline}
          fullscreenId="title-prompt"
          placeholder="Write your title system prompt…"
        />
        <Dialog.Footer className="flex-row justify-between sm:justify-between">
          <ConfirmDialog
            variant="destructive"
            title="Reset title prompt?"
            description="This will replace your current title prompt with the default prompt."
            confirmText="Reset"
            onConfirm={() => setContent(DEFAULT_TITLE_SYSTEM_PROMPT)}
            layer={55}
          >
            <RippleButton variant="input" disabled={isDefault}>
              Reset
            </RippleButton>
          </ConfirmDialog>
          <div className="flex gap-2">
            <RippleButton variant="input" onClick={onClose}>
              Cancel
            </RippleButton>
            <RippleButton onClick={save}>Save</RippleButton>
          </div>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  )
}
