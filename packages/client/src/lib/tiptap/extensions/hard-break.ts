import { HardBreak } from '@tiptap/extension-hard-break'

export const HardBreakKeys = HardBreak.extend({
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => this.editor.commands.setHardBreak(),
    }
  },
})
