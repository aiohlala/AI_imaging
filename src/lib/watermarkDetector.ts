/**
 * 浮水印與文字自動偵測輔助模組
 * 結合 OpenCV.js 實現：
 * 1. 點擊智慧選取（Magic Wand / Click-to-Select）：點擊浮水印任一處，自動擴散並貼合文字邊界。
 * 2. 一鍵自動掃描浮水印（Auto-Scan）：利用形態學梯度與輪廓分析，自動標記圖片中的浮水印與台標。
 */
import { loadOpenCV } from './inpaint'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cv = any

/**
 * 點擊智慧選取文字/浮水印區域 (Magic Wand)
 * @param sourceImage 原圖
 * @param targetMaskCanvas 目標遮罩畫布
 * @param clickX 點擊的 X 座標 (原圖解析度)
 * @param clickY 點擊的 Y 座標 (原圖解析度)
 * @param tolerance 容許度 (預設 25)
 */
export async function smartClickWatermark(
  sourceImage: HTMLImageElement | HTMLCanvasElement,
  targetMaskCanvas: HTMLCanvasElement,
  clickX: number,
  clickY: number,
  tolerance = 25,
): Promise<boolean> {
  const cv = await loadOpenCV()

  const w = (sourceImage as HTMLImageElement).naturalWidth ?? (sourceImage as HTMLCanvasElement).width
  const h = (sourceImage as HTMLImageElement).naturalHeight ?? (sourceImage as HTMLCanvasElement).height

  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = w
  srcCanvas.height = h
  const srcCtx = srcCanvas.getContext('2d')!
  srcCtx.drawImage(sourceImage, 0, 0, w, h)

  let srcMat: Cv = null
  let rgbMat: Cv = null
  let floodMask: Cv = null
  let kernel: Cv = null
  let dilatedMask: Cv = null

  try {
    srcMat = cv.matFromImageData(srcCtx.getImageData(0, 0, w, h))
    rgbMat = new cv.Mat()
    cv.cvtColor(srcMat, rgbMat, cv.COLOR_RGBA2RGB)

    // floodFill 遮罩需比原圖寬高各多 2 像素
    floodMask = cv.Mat.zeros(h + 2, w + 2, cv.CV_8UC1)
    const seedPoint = new cv.Point(Math.round(clickX), Math.round(clickY))
    const newVal = new cv.Scalar(255, 255, 255)
    const loDiff = new cv.Scalar(tolerance, tolerance, tolerance)
    const upDiff = new cv.Scalar(tolerance, tolerance, tolerance)

    // FLOODFILL_FIXED_RANGE (1 << 16) | FLOODFILL_MASK_ONLY (1 << 17) | 4-connectivity
    const flags = 4 | (1 << 16) | (1 << 17) | (255 << 8)

    cv.floodFill(rgbMat, floodMask, seedPoint, newVal, new cv.Rect(), loDiff, upDiff, flags)

    // 裁切回原圖尺寸 (去掉多加的 1px 邊框)
    const rect = new cv.Rect(1, 1, w, h)
    const subMask = floodMask.roi(rect)

    // 膨脹 3px 確保完整涵蓋抗鋸齒邊界
    kernel = cv.Mat.ones(5, 5, cv.CV_8U)
    dilatedMask = new cv.Mat()
    cv.dilate(subMask, dilatedMask, kernel)

    // 將產生的遮罩以 source-over 繪製回 targetMaskCanvas
    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = w
    maskCanvas.height = h
    const maskCtx = maskCanvas.getContext('2d')!
    const imgData = maskCtx.createImageData(w, h)
    const maskData = dilatedMask.data

    for (let i = 0; i < w * h; i++) {
      if (maskData[i] > 0) {
        const p = i * 4
        imgData.data[p] = 255
        imgData.data[p + 1] = 255
        imgData.data[p + 2] = 255
        imgData.data[p + 3] = 255
      }
    }
    maskCtx.putImageData(imgData, 0, 0)

    const targetCtx = targetMaskCanvas.getContext('2d')!
    targetCtx.drawImage(maskCanvas, 0, 0)
    subMask.delete()
    return true
  } finally {
    for (const mat of [srcMat, rgbMat, floodMask, kernel, dilatedMask]) {
      if (mat) mat.delete()
    }
  }
}

/**
 * AI / 演算法全圖掃描高對比浮水印與文字區域
 */
export async function autoScanWatermarks(
  sourceImage: HTMLImageElement | HTMLCanvasElement,
  targetMaskCanvas: HTMLCanvasElement,
): Promise<number> {
  const cv = await loadOpenCV()

  const w = (sourceImage as HTMLImageElement).naturalWidth ?? (sourceImage as HTMLCanvasElement).width
  const h = (sourceImage as HTMLImageElement).naturalHeight ?? (sourceImage as HTMLCanvasElement).height

  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = w
  srcCanvas.height = h
  const srcCtx = srcCanvas.getContext('2d')!
  srcCtx.drawImage(sourceImage, 0, 0, w, h)

  let srcMat: Cv = null
  let gray: Cv = null
  let gradX: Cv = null
  let gradY: Cv = null
  let grad: Cv = null
  let thresh: Cv = null
  let closeKernel: Cv = null
  let closed: Cv = null
  let contours: Cv = null
  let hierarchy: Cv = null

  try {
    srcMat = cv.matFromImageData(srcCtx.getImageData(0, 0, w, h))
    gray = new cv.Mat()
    cv.cvtColor(srcMat, gray, cv.COLOR_RGBA2GRAY)

    // Sobel 邊緣梯度
    gradX = new cv.Mat()
    gradY = new cv.Mat()
    cv.Sobel(gray, gradX, cv.CV_8U, 1, 0, 3)
    cv.Sobel(gray, gradY, cv.CV_8U, 0, 1, 3)
    grad = new cv.Mat()
    cv.addWeighted(gradX, 0.5, gradY, 0.5, 0, grad)

    // Otsu 二值化
    thresh = new cv.Mat()
    cv.threshold(grad, thresh, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU)

    // 形態學橫向閉運算，使字元連成文字塊
    closeKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(12, 3))
    closed = new cv.Mat()
    cv.morphologyEx(thresh, closed, cv.MORPH_CLOSE, closeKernel)

    // 尋找輪廓
    contours = new cv.MatVector()
    hierarchy = new cv.Mat()
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    const targetCtx = targetMaskCanvas.getContext('2d')!
    targetCtx.fillStyle = '#fff'

    let detectedCount = 0
    const totalArea = w * h

    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i)
      const bound = cv.boundingRect(cnt)
      cnt.delete()

      const boxArea = bound.width * bound.height
      const aspect = bound.width / Math.max(1, bound.height)

      // 過濾條件：
      // 1. 高度適中 (8px ~ 120px)
      // 2. 寬度大於 12px
      // 3. 面積不超過全圖 15% (避免框到整個人物或大背景)
      // 4. 文字長寬比通常大於 1.2
      if (
        bound.height >= 8 &&
        bound.height <= Math.min(150, h * 0.25) &&
        bound.width >= 15 &&
        aspect >= 0.8 &&
        boxArea < totalArea * 0.12 &&
        boxArea > 100
      ) {
        // 微幅擴張邊界 3px
        const pad = 4
        const rx = Math.max(0, bound.x - pad)
        const ry = Math.max(0, bound.y - pad)
        const rw = Math.min(w - rx, bound.width + pad * 2)
        const rh = Math.min(h - ry, bound.height + pad * 2)

        targetCtx.fillRect(rx, ry, rw, rh)
        detectedCount++
      }
    }

    return detectedCount
  } finally {
    for (const mat of [srcMat, gray, gradX, gradY, grad, thresh, closeKernel, closed, hierarchy]) {
      if (mat) mat.delete()
    }
    if (contours) contours.delete()
  }
}
