/**
 * Google MediaPipe Tasks Vision 純前端本機 AI 封裝
 * 100% 在瀏覽器本機執行 WebAssembly/WebGPU，圖片絕不上傳。
 */
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision'

// 嚴格對齊 package.json 安裝之版本 1.0.1
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'

// Google 官方託管之 Selfie Multiclass 模型 (0: background, 1: hair, 2: body-skin, 3: face-skin, 4: clothes, 5: others)
const MULTICLASS_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite'

// Google 官方託管之 Selfie Segmenter (用於極致精準去背)
const SELFIE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'

let multiclassSegmenterPromise: Promise<ImageSegmenter> | null = null
let selfieSegmenterPromise: Promise<ImageSegmenter> | null = null

async function getMulticlassSegmenter(): Promise<ImageSegmenter> {
  if (!multiclassSegmenterPromise) {
    multiclassSegmenterPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL)
      try {
        return await ImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MULTICLASS_MODEL_URL,
            delegate: 'GPU',
          },
          runningMode: 'IMAGE',
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        })
      } catch (gpuError) {
        console.warn('WebGPU delegate failed, fallback to CPU', gpuError)
        return await ImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MULTICLASS_MODEL_URL,
            delegate: 'CPU',
          },
          runningMode: 'IMAGE',
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        })
      }
    })()
    multiclassSegmenterPromise.catch(() => {
      multiclassSegmenterPromise = null
    })
  }
  return multiclassSegmenterPromise
}

async function getSelfieSegmenter(): Promise<ImageSegmenter> {
  if (!selfieSegmenterPromise) {
    selfieSegmenterPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL)
      try {
        return await ImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: SELFIE_MODEL_URL,
            delegate: 'GPU',
          },
          runningMode: 'IMAGE',
          outputConfidenceMasks: true,
        })
      } catch (gpuError) {
        console.warn('WebGPU delegate failed, fallback to CPU', gpuError)
        return await ImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: SELFIE_MODEL_URL,
            delegate: 'CPU',
          },
          runningMode: 'IMAGE',
          outputConfidenceMasks: true,
        })
      }
    })()
    selfieSegmenterPromise.catch(() => {
      selfieSegmenterPromise = null
    })
  }
  return selfieSegmenterPromise
}

export interface SegmentationResult {
  /** 臉部皮膚遮罩（白色為臉部） */
  faceSkinMask: HTMLCanvasElement
  /** 身體皮膚遮罩（白色為身體/脖子） */
  bodySkinMask: HTMLCanvasElement
  /** 完整人物主體遮罩（包含頭髮、皮膚、衣服） */
  personMask: HTMLCanvasElement
}

/**
 * 使用 MediaPipe Selfie Multiclass 模型自動分離人像類別（臉部、身體皮膚、主體）
 */
export async function segmentPersonCategories(
  source: HTMLImageElement | HTMLCanvasElement,
): Promise<SegmentationResult> {
  const segmenter = await getMulticlassSegmenter()
  const w = (source as HTMLImageElement).naturalWidth ?? (source as HTMLCanvasElement).width
  const h = (source as HTMLImageElement).naturalHeight ?? (source as HTMLCanvasElement).height

  const tempCanvas = document.createElement('canvas')
  tempCanvas.width = w
  tempCanvas.height = h
  const tempCtx = tempCanvas.getContext('2d')!
  tempCtx.drawImage(source, 0, 0, w, h)

  const result = segmenter.segment(tempCanvas)
  const categoryMask = result.categoryMask
  if (!categoryMask) {
    throw new Error('MediaPipe 分割失敗，未獲得 categoryMask。')
  }

  const maskWidth = categoryMask.width
  const maskHeight = categoryMask.height
  const maskData = categoryMask.getAsUint8Array()

  const faceCanvas = document.createElement('canvas')
  faceCanvas.width = maskWidth
  faceCanvas.height = maskHeight
  const faceCtx = faceCanvas.getContext('2d')!
  const faceImg = faceCtx.createImageData(maskWidth, maskHeight)

  const bodyCanvas = document.createElement('canvas')
  bodyCanvas.width = maskWidth
  bodyCanvas.height = maskHeight
  const bodyCtx = bodyCanvas.getContext('2d')!
  const bodyImg = bodyCtx.createImageData(maskWidth, maskHeight)

  const personCanvas = document.createElement('canvas')
  personCanvas.width = maskWidth
  personCanvas.height = maskHeight
  const personCtx = personCanvas.getContext('2d')!
  const personImg = personCtx.createImageData(maskWidth, maskHeight)

  const totalPixels = maskWidth * maskHeight
  for (let i = 0; i < totalPixels; i++) {
    const cat = maskData[i]
    const p = i * 4

    if (cat === 3) {
      faceImg.data[p] = 255
      faceImg.data[p + 1] = 255
      faceImg.data[p + 2] = 255
      faceImg.data[p + 3] = 255
    }

    if (cat === 2) {
      bodyImg.data[p] = 255
      bodyImg.data[p + 1] = 255
      bodyImg.data[p + 2] = 255
      bodyImg.data[p + 3] = 255
    }

    if (cat > 0) {
      personImg.data[p] = 255
      personImg.data[p + 1] = 255
      personImg.data[p + 2] = 255
      personImg.data[p + 3] = 255
    }
  }

  faceCtx.putImageData(faceImg, 0, 0)
  bodyCtx.putImageData(bodyImg, 0, 0)
  personCtx.putImageData(personImg, 0, 0)

  const scaleToOriginal = (canvas: HTMLCanvasElement): HTMLCanvasElement => {
    if (canvas.width === w && canvas.height === h) return canvas
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    const ctx = out.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(canvas, 0, 0, w, h)
    return out
  }

  return {
    faceSkinMask: scaleToOriginal(faceCanvas),
    bodySkinMask: scaleToOriginal(bodyCanvas),
    personMask: scaleToOriginal(personCanvas),
  }
}

export interface BackgroundRemovalResult {
  resultCanvas: HTMLCanvasElement
  maskCanvas: HTMLCanvasElement
  confidenceData: Float32Array
  maskWidth: number
  maskHeight: number
  detectedType: 'portrait' | 'object'
}

/**
 * 依據原始 Float32Array 信心度遮罩與指定閾值 (0.05 ~ 0.95) 產生遮罩畫布
 */
export function buildMaskFromConfidence(
  confData: Float32Array,
  maskW: number,
  maskH: number,
  targetW: number,
  targetH: number,
  threshold = 0.5,
): HTMLCanvasElement {
  const rawMaskCanvas = document.createElement('canvas')
  rawMaskCanvas.width = maskW
  rawMaskCanvas.height = maskH
  const rawMaskCtx = rawMaskCanvas.getContext('2d')!
  const rawMaskImg = rawMaskCtx.createImageData(maskW, maskH)

  // 邊緣柔化羽化區間 (以閾值為中心，給予平滑過渡)
  const feather = 0.08
  const low = Math.max(0, threshold - feather)
  const high = Math.min(1, threshold + feather)
  const range = Math.max(0.001, high - low)

  for (let i = 0; i < maskW * maskH; i++) {
    const p = i * 4
    const prob = confData[i]

    let factor = 0
    if (prob >= high) {
      factor = 1
    } else if (prob <= low) {
      factor = 0
    } else {
      factor = (prob - low) / range
    }

    const alpha = Math.round(factor * 255)

    rawMaskImg.data[p] = 255
    rawMaskImg.data[p + 1] = 255
    rawMaskImg.data[p + 2] = 255
    rawMaskImg.data[p + 3] = alpha
  }
  rawMaskCtx.putImageData(rawMaskImg, 0, 0)

  // 縮放遮罩至原圖尺寸
  const fullMaskCanvas = document.createElement('canvas')
  fullMaskCanvas.width = targetW
  fullMaskCanvas.height = targetH
  const fullMaskCtx = fullMaskCanvas.getContext('2d')!
  fullMaskCtx.imageSmoothingEnabled = true
  fullMaskCtx.drawImage(rawMaskCanvas, 0, 0, targetW, targetH)
  return fullMaskCanvas
}


/**
 * 智慧物件/圖標與純色背景分離演算法（非人像物件、LOGO、商品、插畫通用）
 * 取樣邊界與四角像素作為背景基準，計算像素色彩距離，生成高對比信心度遮罩。
 */
export function segmentObjectFromBackground(
  canvas: HTMLCanvasElement,
): { confidenceData: Float32Array; width: number; height: number } {
  const w = canvas.width
  const h = canvas.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const imgData = ctx.getImageData(0, 0, w, h)
  const data = imgData.data

  // 1. 取樣四個角落像素
  const getPixel = (x: number, y: number) => {
    const idx = (y * w + x) * 4
    return [data[idx], data[idx + 1], data[idx + 2]]
  }

  const cTL = getPixel(0, 0)
  const cTR = getPixel(w - 1, 0)
  const cBL = getPixel(0, h - 1)
  const cBR = getPixel(w - 1, h - 1)

  // 2. 取樣四條外邊界像素計算平均背景色彩
  let rSum = 0, gSum = 0, bSum = 0, count = 0
  for (let x = 0; x < w; x += 2) {
    const p1 = x * 4
    const p2 = ((h - 1) * w + x) * 4
    rSum += data[p1] + data[p2]
    gSum += data[p1 + 1] + data[p2 + 1]
    bSum += data[p1 + 2] + data[p2 + 2]
    count += 2
  }
  for (let y = 1; y < h - 1; y += 2) {
    const p1 = (y * w) * 4
    const p2 = (y * w + (w - 1)) * 4
    rSum += data[p1] + data[p2]
    gSum += data[p1 + 1] + data[p2 + 1]
    bSum += data[p1 + 2] + data[p2 + 2]
    count += 2
  }

  const cAvg = [rSum / count, gSum / count, bSum / count]
  const bgSamples = [cTL, cTR, cBL, cBR, cAvg]

  const totalPixels = w * h
  const confData = new Float32Array(totalPixels)

  // 3. 計算每個像素到最近背景取樣點的色差
  for (let i = 0; i < totalPixels; i++) {
    const p = i * 4
    const pr = data[p]
    const pg = data[p + 1]
    const pb = data[p + 2]

    let minDist = 9999
    for (const [sr, sg, sb] of bgSamples) {
      const dr = pr - sr
      const dg = pg - sg
      const db = pb - sb
      const d = Math.sqrt(dr * dr + dg * dg + db * db)
      if (d < minDist) minDist = d
    }

    // 歸一化：距離 < 15 確信為背景 (norm = 0)，距離 > 85 確信為前景 (norm = 1)
    const norm = Math.min(1, Math.max(0, (minDist - 15) / 70))
    confData[i] = norm
  }

  return {
    confidenceData: confData,
    width: w,
    height: h,
  }
}

/**
 * AI 一鍵去除背景（支援人像神經網路與智慧物件分離）
 */
export async function removeBackgroundAI(
  source: HTMLImageElement | HTMLCanvasElement,
  threshold = 0.5,
  mode: 'auto' | 'portrait' | 'object' = 'auto',
): Promise<BackgroundRemovalResult> {
  const w = (source as HTMLImageElement).naturalWidth ?? (source as HTMLCanvasElement).width
  const h = (source as HTMLImageElement).naturalHeight ?? (source as HTMLCanvasElement).height

  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = w
  srcCanvas.height = h
  const srcCtx = srcCanvas.getContext('2d')!
  srcCtx.drawImage(source, 0, 0, w, h)

  let finalConfData: Float32Array
  let maskW: number
  let maskH: number
  let detectedType: 'portrait' | 'object' = 'portrait'

  if (mode === 'object') {
    const objRes = segmentObjectFromBackground(srcCanvas)
    finalConfData = objRes.confidenceData
    maskW = objRes.width
    maskH = objRes.height
    detectedType = 'object'
  } else {
    const segmenter = await getSelfieSegmenter()
    const result = segmenter.segment(srcCanvas)
    const confMask = result.confidenceMasks?.[0]
    if (!confMask) {
      throw new Error('去背模型分割失敗。')
    }

    const mWidth = confMask.width
    const mHeight = confMask.height
    const confData = confMask.getAsFloat32Array()

    // 評估是否有人像特徵
    let maxProb = 0
    let personCount = 0
    const sampleStep = 4
    for (let i = 0; i < confData.length; i += sampleStep) {
      const p = confData[i]
      if (p > maxProb) maxProb = p
      if (p > 0.3) personCount++
    }

    const hasPerson =
      maxProb >= 0.28 && personCount >= Math.max(30, (confData.length / sampleStep) * 0.004)

    if (mode === 'auto' && !hasPerson) {
      // 自動判定為非人像（如月亮、圖標、LOGO、插畫），無縫啟用智慧物件分離
      const objRes = segmentObjectFromBackground(srcCanvas)
      finalConfData = objRes.confidenceData
      maskW = objRes.width
      maskH = objRes.height
      detectedType = 'object'
    } else {
      finalConfData = confData
      maskW = mWidth
      maskH = mHeight
      detectedType = 'portrait'
    }
  }

  // 依閾值計算遮罩畫布
  const fullMaskCanvas = buildMaskFromConfidence(finalConfData, maskW, maskH, w, h, threshold)

  // 套用遮罩產出透明背景圖
  const outCanvas = document.createElement('canvas')
  outCanvas.width = w
  outCanvas.height = h
  const outCtx = outCanvas.getContext('2d')!
  outCtx.drawImage(srcCanvas, 0, 0)
  outCtx.globalCompositeOperation = 'destination-in'
  outCtx.drawImage(fullMaskCanvas, 0, 0)

  return {
    resultCanvas: outCanvas,
    maskCanvas: fullMaskCanvas,
    confidenceData: finalConfData,
    maskWidth: maskW,
    maskHeight: maskH,
    detectedType,
  }
}
