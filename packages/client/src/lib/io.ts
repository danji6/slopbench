import type { Area, Size } from '@/lib/math'
import * as Gif from 'modern-gif'

export const ACCEPTED_IMAGE_TYPES = [
  {
    mime: 'image/jpeg',
    extensions: ['jpg', 'jpeg'],
    pattern: [0xff, 0xd8, 0xff],
    mask: [0xff, 0xff, 0xff],
  },
  {
    mime: 'image/png',
    extensions: ['png'],
    pattern: [0x89, 0x50, 0x4e, 0x47],
    mask: [0xff, 0xff, 0xff, 0xff],
  },
  {
    mime: 'image/webp',
    extensions: ['webp'],
    pattern: [0x52, 0x49, 0x46, 0x46],
    mask: [0xff, 0xff, 0xff, 0xff],
  },
  {
    mime: 'image/gif',
    extensions: ['gif'],
    pattern: [0x47, 0x49, 0x46, 0x38],
    mask: [0xff, 0xff, 0xff, 0xff],
  },
]

export const ACCEPTED_VIDEO_TYPES = [
  {
    mime: 'video/mp4',
    extensions: ['mp4'],
  },
  {
    mime: 'video/webm',
    extensions: ['webm'],
  },
]

export const ACCEPTED_MIME_TYPES = [
  ...ACCEPTED_IMAGE_TYPES.map((item) => item.mime),
  ...ACCEPTED_VIDEO_TYPES.map((item) => item.mime),
]

export type ResizeFit = 'cover' | 'contain' | 'fill' | 'inside' | 'outside'

interface ImageOps {
  crop?: Area
  resize?: Size
  resizeFit?: ResizeFit
  rotate?: number
  flip?: { horizontal: boolean; vertical: boolean }
  compress?: number
  format?: string
}

class IOError extends Error {
  constructor(type: 'canvas' | 'resize' | 'process') {
    switch (type) {
      case 'canvas':
        super('Failed to get canvas context')
        break
      case 'resize':
        super('Failed to resize image')
        break
      case 'process':
        super('Failed to process image frame')
        break
      default:
        super('Failed to process image')
    }
    this.name = 'ClientIOError'
  }
}

export class ImageTool {
  private ops: ImageOps = {}

  constructor(public src: string | Blob) {
    this.src = src
  }

  crop(area?: Area) {
    this.ops.crop = area
    return this
  }

  resize(size?: Size, fit: ResizeFit = 'fill') {
    this.ops.resize = size
    this.ops.resizeFit = fit
    return this
  }

  rotate(angle?: number) {
    this.ops.rotate = angle
    return this
  }

  flip(horizontal?: boolean, vertical?: boolean) {
    this.ops.flip = {
      horizontal: horizontal ?? false,
      vertical: vertical ?? false,
    }
    return this
  }

  compress(quality?: number) {
    this.ops.compress = quality
    return this
  }

  format(type?: string) {
    this.ops.format = type
    return this
  }

  async toBlob(): Promise<Blob> {
    return await this._process()
  }

  async toBase64(): Promise<string> {
    const blob = await this.toBlob()
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  async toUrl(): Promise<string> {
    const blob = await this.toBlob()
    return URL.createObjectURL(blob)
  }

  private async _process(): Promise<Blob> {
    const blob =
      this.src instanceof Blob
        ? this.src
        : await fetch(this.src).then((res) => res.blob())

    const mimeType = await readImageMimeType(blob)
    const targetMimeType = this.ops.format ?? mimeType ?? 'image/jpeg'
    const isGif = mimeType === 'image/gif' && mimeType === targetMimeType

    const canvases: OffscreenCanvas[] = []
    let image: ImageBitmap | ImageData
    let frames: Gif.DecodedFrame[] = []
    const delays: number[] = []
    let frameCount: number

    let width: number
    let height: number
    const rotation = ((this.ops.rotate ?? 0) * Math.PI) / 180
    const hFlip = this.ops.flip?.horizontal ?? false
    const vFlip = this.ops.flip?.vertical ?? false

    if (isGif) {
      frames = Gif.decodeFrames(await blob.arrayBuffer())
      frameCount = frames.length
    } else {
      frameCount = 1
    }

    let ctx: OffscreenCanvasRenderingContext2D | null = null

    for (let i = 0; i < frameCount; i++) {
      let canvas = new OffscreenCanvas(1, 1)

      if (!ctx) {
        ctx = canvas.getContext('2d')
        if (!ctx) throw new IOError('canvas')
      }

      if (isGif) {
        const frame = frames?.[i]

        if (!frame) {
          throw new IOError('process')
        }

        image = new ImageData(
          new Uint8ClampedArray(frame.data),
          frame.width,
          frame.height,
        )
        delays.push(frame.delay)
      } else {
        image = await createImageBitmap(blob)
      }

      if (rotation !== 0) {
        const rotatedSize = this._rotateSize(rotation, {
          width: image.width,
          height: image.height,
        })
        width = rotatedSize.width
        height = rotatedSize.height
      } else {
        width = image.width
        height = image.height
      }

      canvas.width = width
      canvas.height = height

      if (rotation !== 0 || hFlip || vFlip) {
        // Center canvas to rotate/flip correctly
        ctx.translate(width / 2, height / 2)

        if (rotation !== 0) {
          ctx.rotate(rotation)
        }

        if (hFlip || vFlip) {
          ctx.scale(hFlip ? -1 : 1, vFlip ? -1 : 1)
        }

        // Translate back to the original position
        ctx.translate(-image.width / 2, -image.height / 2)
      }

      // Ensure a white background for PNG to JPEG conversion
      if (this.ops.format === 'image/jpeg') {
        ctx.fillStyle = 'white'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }

      if (image instanceof ImageData) {
        ctx.putImageData(image, 0, 0)
      } else {
        ctx.drawImage(image, 0, 0)
      }

      if (this.ops.crop) {
        const newCanvas = this._crop(canvas, this.ops.crop)
        canvas = newCanvas.canvas
        ctx = newCanvas.ctx
      }

      if (this.ops.resize) {
        canvas = this._resize(
          canvas,
          this.ops.resize,
          this.ops.resizeFit ?? 'fill',
        )
      }

      canvases.push(canvas)
    }

    if (isGif) {
      const data: { data: OffscreenCanvas; delay: number }[] = []

      for (let i = 0; i < frameCount; i++) {
        data.push({
          data: canvases[i],
          delay: delays[i],
        })
      }

      const gif = await Gif.encode({
        format: 'blob',
        width: canvases[0].width,
        height: canvases[0].height,
        frames: data,
      })

      return new Blob([gif], { type: targetMimeType })
    }

    return await canvases[0].convertToBlob({
      type: targetMimeType,
      quality: this.ops.compress ?? 1,
    })
  }

  private _rotateSize(rotation: number, size: Size): Size {
    return {
      width:
        Math.abs(Math.cos(rotation) * size.width) +
        Math.abs(Math.sin(rotation) * size.height),
      height:
        Math.abs(Math.sin(rotation) * size.width) +
        Math.abs(Math.cos(rotation) * size.height),
    }
  }

  private _crop(
    original: OffscreenCanvas,
    crop: Area,
  ): {
    canvas: OffscreenCanvas
    ctx: OffscreenCanvasRenderingContext2D
  } {
    const { width: w, height: h, x, y } = crop

    const croppedCanvas = new OffscreenCanvas(w, h)
    const ctx = croppedCanvas.getContext('2d')

    if (!ctx) {
      throw new IOError('canvas')
    }

    ctx.drawImage(original, x, y, w, h, 0, 0, w, h)

    return { canvas: croppedCanvas, ctx }
  }

  private _resize(
    original: OffscreenCanvas,
    target: Size,
    fit: ResizeFit,
  ): OffscreenCanvas {
    const srcW = original.width
    const srcH = original.height

    if (fit === 'contain') {
      const scale = Math.min(target.width / srcW, target.height / srcH)
      const scaledW = Math.round(srcW * scale)
      const scaledH = Math.round(srcH * scale)
      const scaled = this._drawScaled(original, scaledW, scaledH)
      const canvas = new OffscreenCanvas(target.width, target.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new IOError('canvas')
      ctx.drawImage(
        scaled,
        Math.round((target.width - scaledW) / 2),
        Math.round((target.height - scaledH) / 2),
      )
      return canvas
    }

    if (fit === 'cover') {
      const scale = Math.max(target.width / srcW, target.height / srcH)
      const scaledW = Math.round(srcW * scale)
      const scaledH = Math.round(srcH * scale)
      const scaled = this._drawScaled(original, scaledW, scaledH)
      const canvas = new OffscreenCanvas(target.width, target.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new IOError('canvas')
      ctx.drawImage(
        scaled,
        Math.round((scaledW - target.width) / 2),
        Math.round((scaledH - target.height) / 2),
        target.width,
        target.height,
        0,
        0,
        target.width,
        target.height,
      )
      return canvas
    }

    let outW: number
    let outH: number

    if (fit === 'inside') {
      const scale = Math.min(1, target.width / srcW, target.height / srcH)
      outW = Math.round(srcW * scale)
      outH = Math.round(srcH * scale)
    } else if (fit === 'outside') {
      const scale = Math.max(1, target.width / srcW, target.height / srcH)
      outW = Math.round(srcW * scale)
      outH = Math.round(srcH * scale)
    } else {
      // fill
      outW = target.width
      outH = target.height
    }

    return this._drawScaled(original, outW, outH)
  }

  private _drawScaled(
    src: OffscreenCanvas,
    outW: number,
    outH: number,
  ): OffscreenCanvas {
    const canvas = new OffscreenCanvas(outW, outH)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new IOError('canvas')

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    const ratio = Math.max(src.width / outW, src.height / outH)
    if (ratio > 2) {
      const intermediateWidth = Math.round(src.width / Math.sqrt(ratio))
      const intermediateHeight = Math.round(src.height / Math.sqrt(ratio))
      const intermediate = new OffscreenCanvas(
        intermediateWidth,
        intermediateHeight,
      )
      const iCtx = intermediate.getContext('2d')
      if (!iCtx) throw new IOError('canvas')
      iCtx.imageSmoothingEnabled = true
      iCtx.imageSmoothingQuality = 'high'
      iCtx.drawImage(src, 0, 0, intermediateWidth, intermediateHeight)
      ctx.drawImage(intermediate, 0, 0, outW, outH)
    } else {
      ctx.drawImage(src, 0, 0, outW, outH)
    }

    return canvas
  }
}

export async function isThumbnailable(src: string): Promise<boolean> {
  if (!src) return false

  if (src.startsWith('data:image/') || src.startsWith('data:video/')) {
    return true
  }

  try {
    const blob = await fetch(src).then((res) => res.blob())
    const mimeType = await readImageMimeType(blob)
    if (mimeType) return true
    if (
      ACCEPTED_MIME_TYPES.some((mt) => blob.type.startsWith(mt.split('/')[0]))
    ) {
      return true
    }
  } catch {
    // Ignore fetch/CORS errors and proceed to fallback
  }

  // If we can't determine it via fetch/magic bits, the browser might natively support it still
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    img.src = src
  })
}

export function isDisplayableUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return (
    url.startsWith('data:') || url.startsWith('http') || url.startsWith('blob:')
  )
}

export async function thumbnail(
  src: string,
  size = 256,
): Promise<string | null> {
  if (!src) return null
  if (!(await isThumbnailable(src))) return null

  try {
    const blob = src.startsWith('data:')
      ? await fetch(src).then((res) => res.blob())
      : await fetch(src)
          .then((res) => res.blob())
          .catch(() => null)

    // If fetch failed (CORS), fall back to original src
    if (!blob) return src

    const mimeType = await readImageMimeType(blob)

    if (mimeType) {
      const bitmap = await createImageBitmap(blob)
      const scale = Math.min(size / bitmap.width, size / bitmap.height, 1)
      const width = Math.round(bitmap.width * scale)
      const height = Math.round(bitmap.height * scale)

      const thumbnailBlob = await new ImageTool(blob)
        .resize({ width, height })
        .format('image/webp')
        .compress(0.85)
        .toBlob()

      return URL.createObjectURL(thumbnailBlob)
    }

    if (ACCEPTED_VIDEO_TYPES.some((vt) => blob.type === vt.mime)) {
      const videoThumbnail = await captureVideoFrame(src)
      const bitmap = await createImageBitmap(videoThumbnail)
      const scale = Math.min(size / bitmap.width, size / bitmap.height, 1)
      const width = Math.round(bitmap.width * scale)
      const height = Math.round(bitmap.height * scale)

      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new IOError('canvas')

      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, 0, 0, width, height)

      const thumbnailBlob = await canvas.convertToBlob({
        type: 'image/webp',
        quality: 0.85,
      })
      return URL.createObjectURL(thumbnailBlob)
    }

    // Default fallback to original src for other thumbnailable types (like some browser-supported ones)
    return src
  } catch (error: unknown) {
    console.warn(
      'Failed to generate thumbnail, falling back to original src:',
      error,
    )
    return src
  }
}

async function captureVideoFrame(videoSrc: string): Promise<Blob> {
  const video = document.createElement('video')
  video.src = videoSrc
  video.crossOrigin = 'anonymous'
  video.muted = true

  await new Promise((resolve, reject) => {
    video.addEventListener('loadedmetadata', resolve)
    video.addEventListener('error', reject)
    video.load()
  })

  video.currentTime = 0

  await new Promise((resolve, reject) => {
    video.addEventListener('seeked', resolve)
    video.addEventListener('error', reject)
  })

  const offscreenCanvas = new OffscreenCanvas(
    video.videoWidth,
    video.videoHeight,
  )
  const ctx = offscreenCanvas.getContext('2d')

  if (!ctx) {
    throw new IOError('canvas')
  }

  ctx.drawImage(video, 0, 0)

  return await offscreenCanvas.convertToBlob()
}

async function readImageMimeType(blob: Blob): Promise<string | null> {
  const reader = new FileReader()
  const signature = blob.slice(0, 4)

  function match(
    bytes: Uint8Array,
    mime: (typeof ACCEPTED_IMAGE_TYPES)[number],
  ) {
    for (let i = 0, l = mime.mask.length; i < l; ++i) {
      if ((bytes[i] & mime.mask[i]) - mime.pattern[i] !== 0) {
        return false
      }
    }
    return true
  }

  return await new Promise((resolve) => {
    reader.onloadend = (e) => {
      try {
        const bytes = new Uint8Array(e.target?.result as ArrayBuffer)

        for (let i = 0, l = ACCEPTED_IMAGE_TYPES.length; i < l; ++i) {
          if (match(bytes, ACCEPTED_IMAGE_TYPES[i])) {
            resolve(ACCEPTED_IMAGE_TYPES[i].mime)
          }
        }
      } catch (error: unknown) {
        console.error(error)
        resolve(null)
      }
      resolve(null)
    }

    reader.readAsArrayBuffer(signature)
  })
}
