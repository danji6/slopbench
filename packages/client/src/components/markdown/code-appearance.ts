import { DEFAULT_SETTINGS } from '@sb/convex/model/defaults'
import { createContext, useContext } from 'react'

export type CodeAppearance = {
  highlighting: boolean
  lineNumbers: boolean
}

export const CodeAppearanceContext = createContext<CodeAppearance>({
  highlighting: DEFAULT_SETTINGS.codeBlockHighlighting,
  lineNumbers: DEFAULT_SETTINGS.codeBlockLineNumbers,
})

export function useCodeAppearance(): CodeAppearance {
  return useContext(CodeAppearanceContext)
}
