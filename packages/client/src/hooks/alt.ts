import { useMemo } from 'react'

export type AltMetadata = {
  hidden?: boolean
  thumbnail?: boolean
  banner?: boolean
  width: number
  height: number
  float?: 'left' | 'right'
  imageRendering?: 'pixelated' | 'auto'
  backgroundColor?: string
  objectFit: 'cover' | 'contain'
  objectPosition?: string
  description?: string
}

const metaReg =
  /{(\s*(?:\d+(?:x\d+)?|\d+%|hidden|thumbnail|banner|pixel|left|right|bg:[^}\s]+)\s*)+}/

/**
 * Parses alt text metadata from markdown embeddings (see markdown.tsx):
 * - `<size>`
 * - `<width>x<height>`
 * - `<width>x<height> <alignY>%`
 * - `<width>x<height> <alignX>% <alignY>%`
 * - `pixel`
 * - `left`
 * - `right`
 * - `bg:<color>`
 * - `thumbnail`
 * - `banner`
 * - `hidden`
 */
export function useAltMetadata(alt: string | undefined): AltMetadata {
  return useMemo(() => {
    let hidden = false
    let thumbnail = false
    let banner = false
    let width = 0
    let height = 0
    let float: 'left' | 'right' | undefined
    let imageRendering: 'pixelated' | 'auto' = 'auto'
    let backgroundColor: string | undefined
    let alignX: string | undefined
    let alignY: string | undefined
    let description: string | undefined

    if (alt) {
      const match = alt.match(metaReg)

      if (match) {
        const content = match[0]
        const inner = content.slice(1, -1)
        const tokens = inner.split(/\s+/).filter(Boolean)
        const alignments: string[] = []

        tokens.forEach((token) => {
          if (token === 'hidden') hidden = true
          else if (token === 'thumbnail') thumbnail = true
          else if (token === 'banner') banner = true
          else if (token === 'pixel') imageRendering = 'pixelated'
          else if (token === 'left') float = 'left'
          else if (token === 'right') float = 'right'
          else if (token.match(/^bg:\S+$/)) backgroundColor = token.slice(3)
          else if (token.match(/^\d+%$/)) alignments.push(token)
          else if (token.match(/^\d+(?:x\d+)?$/)) {
            const parts = token.split('x')
            width = Number(parts[0])
            height = parts[1] ? Number(parts[1]) : width
          }
        })

        if (alignments.length > 0) alignX = alignments[0]
        if (alignments.length > 0) alignY = alignments[1] || alignments[0]

        description = alt.replace(metaReg, '').trim()
      } else {
        description = alt
      }
    }

    if (Number.isNaN(width)) {
      width = 0
    }

    if (Number.isNaN(height)) {
      height = width
    }

    const objectFit = width === height ? 'contain' : 'cover'
    const objectPosition = `${alignX || '50%'} ${alignY || '50%'}`

    return {
      hidden,
      thumbnail,
      banner,
      width,
      height,
      float,
      imageRendering,
      backgroundColor,
      objectFit,
      objectPosition,
      description,
    }
  }, [alt])
}
