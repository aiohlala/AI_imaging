/**
 * GIF 動態圖浮水印去除與編碼核心模組
 * 100% 瀏覽器本機 WebAssembly / JavaScript 運算
 */
import omggif from 'omggif'
import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import { inpaint } from './inpaint'

export interface GifFrame {
  /** 完整還原後的影格畫布 */
  canvas: HTMLCanvasElement
  /** 影格持續時間 (毫秒) */
  delay: number
}

export interface GifContext {
  frames: GifFrame[]
  width: number
  height: number
  loopCount: number
}

export interface GifInpaintResult {
  /** 第一幀代表畫布 (相容原本的靜態介面) */
  canvas: HTMLCanvasElement
  /** 所有修復後的動態影格 */
  cleanFrames: GifFrame[]
  /** 最終編碼成的 GIF Blob */
  gifBlob: Blob
  /** 是否曾縮小過 */
  downscaled: boolean
}

/** 判斷二進位資料是否為動態 GIF (包含超過 1 幀) */
export function isAnimatedGif(buffer: ArrayBuffer): boolean {
  try {
    const bytes = new Uint8Array(buffer)
    if (bytes.length < 6) return false
    const header = String.fromCharCode(...bytes.subarray(0, 6))
    if (header !== 'GIF89a' && header !== 'GIF87a') return false

    const reader = new omggif.GifReader(bytes)
    return reader.numFrames() > 1
  } catch {
    return false
  }
}

/** 將 GIF ArrayBuffer 解碼並還原為每幀獨立的 Canvas 列表 */
export function decodeGif(buffer: ArrayBuffer): GifContext {
  const bytes = new Uint8Array(buffer)
  const reader = new omggif.GifReader(bytes)
  const numFrames = reader.numFrames()
  const width = reader.width
  const height = reader.height
  const loopCount = reader.loopCount() ?? 0

  const frames: GifFrame[] = []
  const pixelBuf = new Uint8ClampedArray(width * height * 4)

  for (let i = 0; i < numFrames; i++) {
    reader.decodeAndBlitFrameRGBA(i, pixelBuf)
    const info = reader.frameInfo(i)

    const frameCanvas = document.createElement('canvas')
    frameCanvas.width = width
    frameCanvas.height = height
    const ctx = frameCanvas.getContext('2d')!
    const imgData = new ImageData(new Uint8ClampedArray(pixelBuf), width, height)
    ctx.putImageData(imgData, 0, 0)

    const delayMs = info.delay > 1 ? info.delay * 10 : 100

    frames.push({
      canvas: frameCanvas,
      delay: delayMs,
    })
  }

  return {
    frames,
    width,
    height,
    loopCount,
  }
}

/** 計算 Mask 標記區域的外接矩形 (ROI) */
export function getMaskBoundingBox(
  maskCanvas: HTMLCanvasElement,
): { x: number; y: number; width: number; height: number } | null {
  const ctx = maskCanvas.getContext('2d')!
  const imgData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height)
  const data = imgData.data
  let minX = maskCanvas.width
  let minY = maskCanvas.height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < maskCanvas.height; y++) {
    const rowOffset = y * maskCanvas.width
    for (let x = 0; x < maskCanvas.width; x++) {
      const alpha = data[(rowOffset + x) * 4 + 3]
      if (alpha > 10) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX === -1) return null

  // 往外擴展 8px 作為周圍修復樣本邊緣
  const pad = 8
  const x = Math.max(0, minX - pad)
  const y = Math.max(0, minY - pad)
  const w = Math.min(maskCanvas.width - x, maxX - minX + 1 + pad * 2)
  const h = Math.min(maskCanvas.height - y, maxY - minY + 1 + pad * 2)

  return { x, y, width: w, height: h }
}

/**
 * 執行 GIF 逐幀高效率 ROI Inpainting 並封裝為 GIF
 */
export async function inpaintGif(
  frames: GifFrame[],
  maskCanvas: HTMLCanvasElement,
  onProgress?: (currentFrame: number, totalFrames: number) => void,
): Promise<GifInpaintResult> {
  if (frames.length === 0) {
    throw new Error('GIF 影格數量為 0')
  }

  const width = frames[0].canvas.width
  const height = frames[0].canvas.height
  const totalFrames = frames.length

  // 1. 偵測浮水印局部區域 (ROI)
  const bbox = getMaskBoundingBox(maskCanvas)
  const isRoiApplicable = bbox !== null && bbox.width * bbox.height < width * height * 0.75

  let roiMaskCanvas: HTMLCanvasElement | null = null
  if (isRoiApplicable && bbox) {
    roiMaskCanvas = document.createElement('canvas')
    roiMaskCanvas.width = bbox.width
    roiMaskCanvas.height = bbox.height
    const rCtx = roiMaskCanvas.getContext('2d')!
    rCtx.drawImage(maskCanvas, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height)
  }

  const cleanFrames: GifFrame[] = []
  const encoder = GIFEncoder()

  // 2. 逐幀執行局部修復 (ROI inpaint)
  for (let i = 0; i < totalFrames; i++) {
    if (onProgress) {
      onProgress(i + 1, totalFrames)
    }

    const origFrame = frames[i]
    const cleanCanvas = document.createElement('canvas')
    cleanCanvas.width = width
    cleanCanvas.height = height
    const cleanCtx = cleanCanvas.getContext('2d')!
    cleanCtx.drawImage(origFrame.canvas, 0, 0)

    if (isRoiApplicable && bbox && roiMaskCanvas) {
      const roiCanvas = document.createElement('canvas')
      roiCanvas.width = bbox.width
      roiCanvas.height = bbox.height
      const roiCtx = roiCanvas.getContext('2d')!
      roiCtx.drawImage(origFrame.canvas, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height)

      const roiResult = await inpaint(roiCanvas, roiMaskCanvas)
      cleanCtx.drawImage(roiResult.canvas, bbox.x, bbox.y)
    } else {
      const fullResult = await inpaint(origFrame.canvas, maskCanvas)
      cleanCtx.drawImage(fullResult.canvas, 0, 0)
    }

    cleanFrames.push({
      canvas: cleanCanvas,
      delay: origFrame.delay,
    })

    // 3. GIF 調色盤量化與幀寫入
    const frameData = cleanCtx.getImageData(0, 0, width, height).data
    const palette = quantize(frameData, 256)
    const index = applyPalette(frameData, palette)
    encoder.writeFrame(index, width, height, {
      palette,
      delay: origFrame.delay,
    })
  }

  encoder.finish()
  const gifBytes = encoder.bytes()
  const gifBlob = new Blob([gifBytes.buffer as ArrayBuffer], { type: 'image/gif' })

  return {
    canvas: cleanFrames[0].canvas,
    cleanFrames,
    gifBlob,
    downscaled: false,
  }
}
