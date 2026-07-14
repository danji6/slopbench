import type { TextUIPart } from 'ai'

import { EditableText } from './editor/editable-text'
import { SmoothText } from './smooth-text'

const fontStyle = {
  fontFamily: 'var(--chat-font-family)',
  fontSize: 'var(--chat-font-size)',
}

export type TextBlockProps = {
  part: TextUIPart
  segmentIndex?: number
  index?: number
}

export function TextBlock({ part, segmentIndex, index }: TextBlockProps) {
  if (!part.text) return null

  return (
    <EditableText
      data-slot="text-block"
      part={part}
      segmentIndex={segmentIndex}
      index={index}
      style={fontStyle}
    >
      <SmoothText part={part} />
    </EditableText>
  )
}
