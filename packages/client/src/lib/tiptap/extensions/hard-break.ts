import { HardBreak } from '@tiptap/extension-hard-break'

export const HardBreakKeys = HardBreak.extend({
  addOptions() {
    return { ...this.parent!(), keepMarks: false }
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => this.editor.commands.setHardBreak(),
    }
  },
})
