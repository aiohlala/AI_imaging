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

  // 建立來源 Canvas 以確保格式統一
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

  // 建立分類畫布
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

    // 類別定義 (MediaPipe Multiclass):
    // 0: background
    // 1: hair
    // 2: body-skin
    // 3: face-skin
    // 4: clothes
    // 5: others

    if (cat === 3) {
      // 臉部皮膚
      faceImg.data[p] = 255
      faceImg.data[p + 1] = 255
      faceImg.data[p + 2] = 255
      faceImg.data[p + 3] = 255
    }

    if (cat === 2) {
      // 身體皮膚
      bodyImg.data[p] = 255
      bodyImg.data[p + 1] = 255
      bodyImg.data[p + 2] = 255
      bodyImg.data[p + 3] = 255
    }

    if (cat > 0) {
      // 人物主體
      personImg.data[p] = 255
      personImg.data[p + 1] = 255
      personImg.data[p + 2] = 255
      personImg.data[p + 3] = 255
    }
  }

  faceCtx.putImageData(faceImg, 0, 0)
  bodyCtx.putImageData(bodyImg, 0, 0)
  personCtx.putImageData(personImg, 0, 0)

  // 縮放回原圖解析度
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

/**
 * AI 一鍵去除背景（支援高精度邊界切割）
 */
export async function removeBackgroundAI(
  source: HTMLImageElement | HTMLCanvasElement,
): Promise<{ resultCanvas: HTMLCanvasElement; maskCanvas: HTMLCanvasElement }> {
  const segmenter = await getSelfieSegmenter()
  const w = (source as HTMLImageElement).naturalWidth ?? (source as HTMLCanvasElement).width
  const h = (source as HTMLImageElement).naturalHeight ?? (source as HTMLCanvasElement).height

  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = w
  srcCanvas.height = h
  const srcCtx = srcCanvas.getContext('2d')!
  srcCtx.drawImage(source, 0, 0, w, h)

  const result = segmenter.segment(srcCanvas)
  const confMask = result.confidenceMasks?.[0]
  if (!confMask) {
    throw new Error('去背模型分割失敗。')
  }

  const maskW = confMask.width
  const maskH = confMask.height
  const confData = confMask.getAsFloat32Array()

  // 產生全解析度遮罩畫布
  const rawMaskCanvas = document.createElement('canvas')
  rawMaskCanvas.width = maskW
  rawMaskCanvas.height = maskH
  const rawMaskCtx = rawMaskCanvas.getContext('2d')!
  const rawMaskImg = rawMaskCtx.createImageData(maskW, maskH)

  for (let i = 0; i < maskW * maskH; i++) {
    const p = i * 4
    // confData[i] 是前景人物機率 (0.0 ~ 1.0)
    // 透過 S 曲線增強對比，確保主體飽滿且邊界平滑抗鋸齒
    const prob = confData[i]
    const alpha = Math.round(Math.max(0, Math.min(1, prob)) * 255)

    rawMaskImg.data[p] = 255
    rawMaskImg.data[p + 1] = 255
    rawMaskImg.data[p + 2] = 255
    rawMaskImg.data[p + 3] = alpha
  }
  rawMaskCtx.putImageData(rawMaskImg, 0, 0)

  // 縮放遮罩至原圖尺寸
  const fullMaskCanvas = document.createElement('canvas')
  fullMaskCanvas.width = w
  fullMaskCanvas.height = h
  const fullMaskCtx = fullMaskCanvas.getContext('2d')!
  fullMaskCtx.imageSmoothingEnabled = true
  fullMaskCtx.drawImage(rawMaskCanvas, 0, 0, w, h)

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
  }
}
