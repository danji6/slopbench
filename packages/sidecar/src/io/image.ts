import sharp from 'sharp'
import { z } from 'zod'

export const thumbnailImageSchema = z.object({
  imageUrl: z.string().url(),
  size: z.number().int().positive().max(1024).default(256),
})

export const pngImageSchema = z.object({
  imageUrl: z.string().url(),
})

export type ThumbnailImageResult = {
  contentType: 'image/webp'
  data: string
}

export type PngImageResult = {
  contentType: 'image/png'
  data: string
}

export async function thumbnailImage({
  imageUrl,
  size,
}: z.infer<typeof thumbnailImageSchema>): Promise<ThumbnailImageResult> {
  const input = await fetchImage(imageUrl)
  const output = await sharp(input)
    .rotate()
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .webp({ quality: 85 })
    .toBuffer()

  return {
    contentType: 'image/webp',
    data: output.toString('base64'),
  }
}

export async function pngImage({
  imageUrl,
}: z.infer<typeof pngImageSchema>): Promise<PngImageResult> {
  const input = await fetchImage(imageUrl)
  const output = await sharp(input).rotate().png().toBuffer()

  return {
    contentType: 'image/png',
    data: output.toString('base64'),
  }
}

async function fetchImage(imageUrl: string): Promise<Buffer> {
  const response = await fetch(imageUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`)
  }

  return Buffer.from(await response.arrayBuffer())
}
