import { InputRule, type InputRuleFinder } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'

/** Matches inline shortcuts within the current line, without consuming its break. */
function onCurrentLine(find: InputRuleFinder): InputRuleFinder {
  return (text) => {
    const start = text.lastIndexOf('\n') + 1
    const line = text.slice(start)
    if (!(find instanceof RegExp)) {
      const match = find(line)
      return match ? { ...match, index: start + match.index } : null
    }

    const match = find.exec(line)
    if (!match) return null
    return {
      index: start + match.index,
      text: match[0],
      replaceWith: match[match.length - 1],
    }
  }
}

/** Gives StarterKit's inline marks the same shortcuts after Enter as at paragraph starts. */
export const LineStarterKit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map((extension) =>
      extension.type !== 'mark'
        ? extension
        : extension.extend({
            addInputRules() {
              return (this.parent?.() ?? []).map(
                (rule) =>
                  new InputRule({ ...rule, find: onCurrentLine(rule.find) }),
              )
            },
          }),
    )
  },
})
