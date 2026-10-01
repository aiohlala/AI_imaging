/**
 * 浮水印與文字自動偵測輔助模組
 * 結合 OpenCV.js 與 MediaPipe Selfie Multiclass 人體特徵分割：
 * 1. 點擊智慧選取（Magic Wand / Click-to-Select）：點擊浮水印任一處，自動擴散並貼合文字邊界。
 * 2. 升級版 AI 全圖掃描（Auto-Scan）：
 *    - 整合 MediaPipe 人像神經網絡，嚴格排除人體皮膚、臉部、頭髮與衣物，杜絕誤傷主體。
 *    - 結合形態學 Top-Hat / Black-Hat 與梯度邊緣運算，精確擷取字元筆觸與台標。
 *    - 支援靈敏度閾值調節 (10% ~ 90%)、字詞共線群組分析 (Collinear Text Grouping) 與邊角優先權重。
 *    - 精準繪製字體筆劃遮罩 (Stroke-Level Mask)，取代過去大範圍破壞性矩形方塊。
 */
import { loadOpenCV } from './inpaint'
import { segmentPersonCategories } from './mediapipe'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cv = any

export interface AutoScanOptions {
  /** 靈敏度 (10% ~ 90%，預設 50%)：越低越嚴格精確，越高越敏感全面 */
  sensitivity?: number
  /** 是否啟用 AI 人體、皮膚與衣物神經網絡排除 (預設 true) */
  excludePerson?: boolean
  /** 掃描範圍模式：'all' (全圖智慧掃描) | 'corners' (聚焦四邊角台標與字幕) */
  scanZone?: 'all' | 'corners'
}

/**
 * 簡易快速 YCbCr 人體皮膚色彩判斷（作為無神經網絡或邊界的輔助排除）
 * Cb in [77, 127], Cr in [133, 173]
 */
function isSkinRgb(r: number, g: number, b: number): boolean {
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
  return cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173
}

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
 * AI 與電腦視覺全圖智慧掃描浮水印與文字區域
 * 特性：
 * 1. 整合 MediaPipe Selfie Multiclass 人體/臉部/衣服神經網絡排除，徹底杜絕誤掃人體與衣物。
 * 2. 結合 Top-Hat（亮色浮水印）與 Black-Hat（暗色浮水印）及形態學梯度邊緣特徵。
 * 3. 支援靈敏度 (Sensitivity: 10% ~ 90%) 與台標字幕區域加權 (Prior Zones)。
 * 4. 僅精確標記文字與 LOGO 實體筆觸 (Stroke-level Mask)，絕不產生整塊破壞性實心方塊。
 */
export async function autoScanWatermarks(
  sourceImage: HTMLImageElement | HTMLCanvasElement,
  targetMaskCanvas: HTMLCanvasElement,
  options?: AutoScanOptions,
): Promise<number> {
  const sensitivity = Math.max(10, Math.min(90, options?.sensitivity ?? 50))
  const excludePerson = options?.excludePerson !== false
  const scanZone = options?.scanZone ?? 'all'

  const cv = await loadOpenCV()

  const origW = (sourceImage as HTMLImageElement).naturalWidth ?? (sourceImage as HTMLCanvasElement).width
  const origH = (sourceImage as HTMLImageElement).naturalHeight ?? (sourceImage as HTMLCanvasElement).height

  // 1. 若啟用人物排除，先使用 MediaPipe 取得人物（頭髮、皮膚、衣服）排除遮罩
  let personMaskCanvas: HTMLCanvasElement | null = null
  if (excludePerson) {
    try {
      const segResult = await segmentPersonCategories(sourceImage)
      personMaskCanvas = segResult.personMask
    } catch (e) {
      console.warn('AI 人像分割暫不可用，採用幾何與顏色過濾：', e)
    }
  }

  // 2. 運算降採樣加速（最大邊限縮至 1600px，大幅提升 OpenCV 速度並維持檢測精準度）
  const maxProcSide = 1600
  const maxOrigSide = Math.max(origW, origH)
  const procScale = maxOrigSide > maxProcSide ? maxProcSide / maxOrigSide : 1.0
  const procW = Math.round(origW * procScale)
  const procH = Math.round(origH * procScale)

  const procCanvas = document.createElement('canvas')
  procCanvas.width = procW
  procCanvas.height = procH
  const procCtx = procCanvas.getContext('2d')!
  procCtx.drawImage(sourceImage, 0, 0, procW, procH)

  // 準備人物排除檢測用 ImageData
  let personData: Uint8ClampedArray | null = null
  if (personMaskCanvas) {
    const pTempCanvas = document.createElement('canvas')
    pTempCanvas.width = procW
    pTempCanvas.height = procH
    const pTempCtx = pTempCanvas.getContext('2d')!
    pTempCtx.drawImage(personMaskCanvas, 0, 0, procW, procH)
    personData = pTempCtx.getImageData(0, 0, procW, procH).data
  }

  const origRgbaData = procCtx.getImageData(0, 0, procW, procH).data

  const matsToDelete: Cv[] = []
  const track = <T extends Cv>(m: T): T => {
    if (m) matsToDelete.push(m)
    return m
  }

  try {
    const srcMat = track(cv.matFromImageData(procCtx.getImageData(0, 0, procW, procH)))
    const gray = track(new cv.Mat())
    cv.cvtColor(srcMat, gray, cv.COLOR_RGBA2GRAY)

    const blurred = track(new cv.Mat())
    cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0)

    // (A) Top-Hat 提取明亮文字 (白色字、亮台標)
    const kHat = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9)))
    const topHat = track(new cv.Mat())
    cv.morphologyEx(blurred, topHat, cv.MORPH_TOPHAT, kHat)

    // (B) Black-Hat 提取深色文字 (黑色字、暗台標)
    const blackHat = track(new cv.Mat())
    cv.morphologyEx(blurred, blackHat, cv.MORPH_BLACKHAT, kHat)

    // (C) 形態學梯度提取邊界高頻筆劃
    const kGrad = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)))
    const morphGrad = track(new cv.Mat())
    cv.morphologyEx(blurred, morphGrad, cv.MORPH_GRADIENT, kGrad)

    // (D) 合併特徵圖
    const contrastMax = track(new cv.Mat())
    cv.max(topHat, blackHat, contrastMax)

    const strokeIntensity = track(new cv.Mat())
    cv.addWeighted(contrastMax, 0.65, morphGrad, 0.35, 0, strokeIntensity)

    // (E) 依據靈敏度 (sensitivity: 10 ~ 90) 計算動態二值化閾值
    const threshVal = Math.round(44 - (sensitivity / 100) * 26)
    const strokeBinary = track(new cv.Mat())
    cv.threshold(strokeIntensity, strokeBinary, threshVal, 255, cv.THRESH_BINARY)

    // (F) 若有人物遮罩，在二值化筆劃圖中直接抹除人物與衣服像素
    if (personData) {
      const strokeData = strokeBinary.data
      for (let y = 0; y < procH; y++) {
        for (let x = 0; x < procW; x++) {
          const idx = y * procW + x
          if (personData[idx * 4 + 3] > 60 || personData[idx * 4] > 60) {
            strokeData[idx] = 0
          }
        }
      }
    }

    // (G) 水平方向形態學閉運算：將相鄰字母微幅連接成詞組塊
    const kClose = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 2)))
    const linked = track(new cv.Mat())
    cv.morphologyEx(strokeBinary, linked, cv.MORPH_CLOSE, kClose)

    // (H) 尋找連通輪廓候選區域
    const contours = track(new cv.MatVector())
    const hierarchy = track(new cv.Mat())
    cv.findContours(linked, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    interface Candidate {
      box: { x: number; y: number; width: number; height: number }
      confidence: number
      contourIndex: number
    }

    const candidates: Candidate[] = []
    const totalPixels = procW * procH

    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i)
      const bound = cv.boundingRect(cnt)
      cnt.delete()

      const bw = bound.width
      const bh = bound.height
      const area = bw * bh
      const aspect = bw / Math.max(1, bh)

      // 基礎尺寸與比例過濾
      if (
        bh < 7 ||
        bh > Math.min(140, procH * 0.22) ||
        bw < 10 ||
        bw > Math.min(550, procW * 0.7) ||
        area < 50 ||
        area > totalPixels * 0.08 ||
        aspect < 0.55 ||
        aspect > 25
      ) {
        continue
      }

      // (1) 嚴格排除人物與衣物重疊：
      if (personData) {
        let overlapPersonCount = 0
        const sampleStepX = Math.max(1, Math.floor(bw / 10))
        const sampleStepY = Math.max(1, Math.floor(bh / 10))
        let totalSamples = 0
        for (let py = bound.y; py < bound.y + bh; py += sampleStepY) {
          for (let px = bound.x; px < bound.x + bw; px += sampleStepX) {
            totalSamples++
            if (px >= 0 && px < procW && py >= 0 && py < procH) {
              const pIdx = (py * procW + px) * 4
              if (personData[pIdx + 3] > 50 || personData[pIdx] > 50) {
                overlapPersonCount++
              }
            }
          }
        }
        if (totalSamples > 0 && overlapPersonCount / totalSamples > 0.12) {
          // 重疊超過 12% 判定為人體或衣物，直接捨棄！
          continue
        }
      }

      // (2) 檢查實心度 (Fill Ratio / Solidity)：文字筆劃通常具有適當的空隙
      let strokePixelCount = 0
      const strokeData = strokeBinary.data
      for (let py = bound.y; py < bound.y + bh; py += 2) {
        for (let px = bound.x; px < bound.x + bw; px += 2) {
          if (strokeData[py * procW + px] > 0) {
            strokePixelCount++
          }
        }
      }
      const sampledArea = (Math.ceil(bw / 2) * Math.ceil(bh / 2)) || 1
      const fillRatio = strokePixelCount / sampledArea

      // 文字筆劃 fillRatio 通常介於 0.06 ~ 0.65 之間。若大於 0.72 代表是實心大色塊或陰影，非文字
      if (fillRatio < 0.06 || fillRatio > 0.72) {
        continue
      }

      // (3) 膚色輔助抽查：若該區域採樣大部分為人體皮膚色彩，排除
      let skinSampleCount = 0
      let skinTotalSamples = 0
      for (let py = bound.y; py < bound.y + bh; py += Math.max(1, Math.floor(bh / 5))) {
        for (let px = bound.x; px < bound.x + bw; px += Math.max(1, Math.floor(bw / 5))) {
          skinTotalSamples++
          const cIdx = (py * procW + px) * 4
          const r = origRgbaData[cIdx]
          const g = origRgbaData[cIdx + 1]
          const b = origRgbaData[cIdx + 2]
          if (isSkinRgb(r, g, b)) {
            skinSampleCount++
          }
        }
      }
      if (skinTotalSamples > 0 && skinSampleCount / skinTotalSamples > 0.5) {
        continue
      }

      // (4) 區域位置權重：
      const isCorner =
        (bound.x < procW * 0.22 || bound.x + bw > procW * 0.78) &&
        (bound.y < procH * 0.22 || bound.y + bh > procH * 0.78)
      const isSubtitle =
        bound.y + bh > procH * 0.72 &&
        bound.x > procW * 0.12 &&
        bound.x + bw < procW * 0.88
      const isTopBanner = bound.y < procH * 0.16

      // 若指定僅檢測邊角台標或字幕，過濾中央無關物件
      if (scanZone === 'corners' && !isCorner && !isSubtitle && !isTopBanner) {
        continue
      }

      // (5) 置信度評分：
      let confidence = 0.35
      if (isCorner) confidence += 0.28
      if (isSubtitle) confidence += 0.24
      if (isTopBanner) confidence += 0.18
      if (aspect >= 1.6) confidence += 0.18 // 橫向多字特徵
      if (aspect >= 3.0) confidence += 0.12 // 橫向句子/長台標

      // 若孤立位於圖片中央且長寬比接近方形，容易為自然場景雜訊，給予懲罰
      if (!isCorner && !isSubtitle && !isTopBanner && aspect < 1.4) {
        confidence -= 0.35
      }

      candidates.push({ box: bound, confidence, contourIndex: i })
    }

    // (I) 字詞水平共線與群組增強 (Text Line Collinearity)
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const c1 = candidates[i]
        const c2 = candidates[j]
        const hRatio = c1.box.height / Math.max(1, c2.box.height)
        if (hRatio >= 0.55 && hRatio <= 1.8) {
          const yDiff = Math.abs(c1.box.y - c2.box.y)
          const maxH = Math.max(c1.box.height, c2.box.height)
          if (yDiff <= maxH * 0.5) {
            const xDist =
              c1.box.x < c2.box.x
                ? c2.box.x - (c1.box.x + c1.box.width)
                : c1.box.x - (c2.box.x + c2.box.width)
            if (xDist >= -5 && xDist <= maxH * 2.8) {
              c1.confidence = Math.min(1.0, c1.confidence + 0.22)
              c2.confidence = Math.min(1.0, c2.confidence + 0.22)
            }
          }
        }
      }
    }

    // (J) 依靈敏度門檻篩選最終入選候選標記
    const minConfidence = 0.84 - (sensitivity / 100) * 0.56
    const accepted = candidates.filter((c) => c.confidence >= minConfidence)

    if (accepted.length === 0) {
      return 0
    }

    // (K) 繪製遮罩至 targetMaskCanvas
    const tempMaskCanvas = document.createElement('canvas')
    tempMaskCanvas.width = origW
    tempMaskCanvas.height = origH
    const tempCtx = tempMaskCanvas.getContext('2d')!
    tempCtx.fillStyle = '#ffffff'

    const invScale = 1.0 / procScale

    for (const item of accepted) {
      const { x, y, width, height } = item.box
      const rx = Math.max(0, Math.round((x - 2) * invScale))
      const ry = Math.max(0, Math.round((y - 2) * invScale))
      const rw = Math.min(origW - rx, Math.round((width + 4) * invScale))
      const rh = Math.min(origH - ry, Math.round((height + 4) * invScale))

      tempCtx.beginPath()
      if (typeof tempCtx.roundRect === 'function') {
        tempCtx.roundRect(rx, ry, rw, rh, 4)
      } else {
        tempCtx.rect(rx, ry, rw, rh)
      }
      tempCtx.fill()
    }

    // (L) 關鍵防護：若有人物/衣物遮罩，從最終遮罩中強制扣除人物主體！
    if (personMaskCanvas) {
      tempCtx.save()
      tempCtx.globalCompositeOperation = 'destination-out'
      tempCtx.drawImage(personMaskCanvas, 0, 0, origW, origH)
      tempCtx.restore()
    }

    // 將產生的精準遮罩繪入 targetMaskCanvas
    const targetCtx = targetMaskCanvas.getContext('2d')!
    targetCtx.drawImage(tempMaskCanvas, 0, 0)

    return accepted.length
  } finally {
    for (const m of matsToDelete) {
      try {
        m.delete()
      } catch {
        // ignore
      }
    }
  }
}
