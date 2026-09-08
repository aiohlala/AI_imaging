/**
 * OpenCV inpaint 封裝。
 * OpenCV.js 為瀏覽器 WASM 模組，僅在第一次執行 inpaint 時動態載入。
 */
import opencvJsUrl from '@techstark/opencv-js/dist/opencv.js?url'

/** 處理時的最長邊上限，避免 OpenCV WASM 記憶體不足 */
const MAX_SIDE = 2500

/** OpenCV inpaint 的鄰域半徑 */
const INPAINT_RADIUS = 5

// @techstark/opencv-js 的型別與 runtime 匯出形式不完全一致，此處以最小必要型別處理
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cv = any

let cvPromise: Promise<Cv> | null = null

/**
 * 以 <script> 標籤載入 OpenCV.js 的 UMD 版本（只載入一次）。
 * 不能用 import('@techstark/opencv-js')：bundler 的 ESM interop 會把
 * emscripten 的 Promise 模組包成以 Promise.prototype 為原型的假 Promise，
 * 被 promise chain 解包時拋出「incompatible receiver」錯誤。
 * UMD 版由 script 標籤執行後會把真正的 Promise 掛到 globalThis.cv。
 */
export function loadOpenCV(): Promise<Cv> {
  if (!cvPromise) {
    cvPromise = (async () => {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script')
        script.src = opencvJsUrl
        script.onload = () => resolve()
        script.onerror = () => reject(new Error('OpenCV.js 載入失敗'))
        document.head.appendChild(script)
      })
      const cv: Cv = await (globalThis as { cv?: Promise<Cv> }).cv
      if (!cv?.Mat) throw new Error('OpenCV.js 初始化失敗')
      return cv
    })()
    // 載入失敗時允許下次重試
    cvPromise.catch(() => {
      cvPromise = null
    })
  }
  return cvPromise
}

export interface InpaintResult {
  /** 處理完成的畫布（若原圖最長邊超過 2500px，尺寸為等比縮小後的結果） */
  canvas: HTMLCanvasElement
  /** 是否因為超過大小上限而縮小過 */
  downscaled: boolean
}

/**
 * 以 OpenCV Telea inpainting 修復 mask 標記的區域。
 * @param source 原圖（HTMLImageElement / HTMLCanvasElement / ImageBitmap）
 * @param maskCanvas 與原圖同解析度的 mask 畫布，非透明像素代表要去除的區域
 */
export async function inpaint(
  source: CanvasImageSource,
  maskCanvas: HTMLCanvasElement,
): Promise<InpaintResult> {
  const cv = await loadOpenCV()

  const srcW = (source as HTMLImageElement).naturalWidth ?? (source as HTMLCanvasElement).width
  const srcH = (source as HTMLImageElement).naturalHeight ?? (source as HTMLCanvasElement).height

  // 超過上限時等比縮小（mask 同步縮放）
  const scale = Math.min(1, MAX_SIDE / Math.max(srcW, srcH))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  const downscaled = scale < 1

  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = w
  srcCanvas.height = h
  const srcCtx = srcCanvas.getContext('2d')!
  srcCtx.drawImage(source, 0, 0, w, h)

  const scaledMask = document.createElement('canvas')
  scaledMask.width = w
  scaledMask.height = h
  const maskCtx = scaledMask.getContext('2d')!
  maskCtx.drawImage(maskCanvas, 0, 0, w, h)

  let srcMat: Cv = null
  let rgbMat: Cv = null
  let maskMat: Cv = null
  let maskGray: Cv = null
  let maskBin: Cv = null
  let dstMat: Cv = null
  let outMat: Cv = null

  try {
    srcMat = cv.matFromImageData(srcCtx.getImageData(0, 0, w, h))
    // cv.inpaint 只接受 8UC1 / 8UC3，先去掉 alpha 通道
    rgbMat = new cv.Mat()
    cv.cvtColor(srcMat, rgbMat, cv.COLOR_RGBA2RGB)

    // mask 轉成 8UC1 二值圖（非零像素代表要修復的區域）
    maskMat = cv.matFromImageData(maskCtx.getImageData(0, 0, w, h))
    maskGray = new cv.Mat()
    cv.cvtColor(maskMat, maskGray, cv.COLOR_RGBA2GRAY)
    maskBin = new cv.Mat()
    cv.threshold(maskGray, maskBin, 0, 255, cv.THRESH_BINARY)

    dstMat = new cv.Mat()
    cv.inpaint(rgbMat, maskBin, dstMat, INPAINT_RADIUS, cv.INPAINT_TELEA)

    // 轉回 RGBA 輸出到 canvas
    outMat = new cv.Mat()
    cv.cvtColor(dstMat, outMat, cv.COLOR_RGB2RGBA)

    const outCanvas = document.createElement('canvas')
    outCanvas.width = w
    outCanvas.height = h
    outCanvas
      .getContext('2d')!
      .putImageData(new ImageData(new Uint8ClampedArray(outMat.data), w, h), 0, 0)
    return { canvas: outCanvas, downscaled }
  } finally {
    // 所有 Mat 用完必須 delete()，避免 WASM 記憶體洩漏
    for (const mat of [srcMat, rgbMat, maskMat, maskGray, maskBin, dstMat, outMat]) {
      if (mat) mat.delete()
    }
  }
}
