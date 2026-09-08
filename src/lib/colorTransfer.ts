/**
 * OKLab 色彩空間轉換與感官統計色彩轉移（Reinhard Color Transfer）。
 * 專為人像膚色調和設計：將亮度（L）與色度（a, b）分離，
 * 在調和色調與底色的同時完整保留原始立體光影與肌膚細節。
 */

/** sRGB 轉線性 RGB */
export function srgbToLinear(c: number): number {
  const norm = c / 255
  return norm <= 0.04045 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4)
}

/** 線性 RGB 轉 sRGB */
export function linearToSrgb(c: number): number {
  const clamped = Math.max(0, Math.min(1, c))
  const s = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055
  return Math.round(Math.max(0, Math.min(255, s * 255)))
}

/** sRGB (0-255) 轉 OKLab (L: 0-1, a: ~ -0.4 to 0.4, b: ~ -0.4 to 0.4) */
export function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)

  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188576 * lg + 0.6299787005 * lb)

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const b_val = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_

  return [L, a, b_val]
}

/** OKLab 轉 sRGB (0-255) */
export function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b

  const l3 = l_ * l_ * l_
  const m3 = m_ * m_ * m_
  const s3 = s_ * s_ * s_

  const lr = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3
  const lg = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3
  const lb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3

  return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)]
}

export interface LabStats {
  meanL: number
  meanA: number
  meanB: number
  stdL: number
  stdA: number
  stdB: number
  count: number
}

/** 計算特定像素集合在 OKLab 中的平均與標準差 */
export function computeLabStats(labArray: Float32Array, validIndices: number[]): LabStats {
  const n = validIndices.length
  if (n === 0) {
    return { meanL: 0.5, meanA: 0, meanB: 0, stdL: 0.1, stdA: 0.05, stdB: 0.05, count: 0 }
  }

  let sumL = 0
  let sumA = 0
  let sumB = 0

  for (let i = 0; i < n; i++) {
    const idx = validIndices[i] * 3
    sumL += labArray[idx]
    sumA += labArray[idx + 1]
    sumB += labArray[idx + 2]
  }

  const meanL = sumL / n
  const meanA = sumA / n
  const meanB = sumB / n

  let varL = 0
  let varA = 0
  let varB = 0

  for (let i = 0; i < n; i++) {
    const idx = validIndices[i] * 3
    const dL = labArray[idx] - meanL
    const dA = labArray[idx + 1] - meanA
    const dB = labArray[idx + 2] - meanB
    varL += dL * dL
    varA += dA * dA
    varB += dB * dB
  }

  // 確保標準差不為 0，避免除以零
  const stdL = Math.max(0.015, Math.sqrt(varL / n))
  const stdA = Math.max(0.008, Math.sqrt(varA / n))
  const stdB = Math.max(0.008, Math.sqrt(varB / n))

  return { meanL, meanA, meanB, stdL, stdA, stdB, count: n }
}

/**
 * 快速邊緣羽化：對 8-bit 單通道遮罩進行分離式盒狀模糊 (3-pass 近似高斯模糊)
 */
export function featherMask(maskAlpha: Uint8Array, width: number, height: number, radius: number): Float32Array {
  const length = width * height
  const result = new Float32Array(length)

  if (radius <= 0) {
    for (let i = 0; i < length; i++) {
      result[i] = maskAlpha[i] / 255
    }
    return result
  }

  // 先轉成 float
  const current = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    current[i] = maskAlpha[i] / 255
  }

  const temp = new Float32Array(length)
  const r = Math.max(1, Math.round(radius))

  // 水平與垂直 3-pass 盒狀模糊
  for (let pass = 0; pass < 2; pass++) {
    // 水平 pass
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width
      let sum = 0
      for (let x = -r; x <= r; x++) {
        const clampedX = Math.min(width - 1, Math.max(0, x))
        sum += current[rowOffset + clampedX]
      }
      for (let x = 0; x < width; x++) {
        temp[rowOffset + x] = sum / (2 * r + 1)
        const nextX = Math.min(width - 1, x + r + 1)
        const prevX = Math.max(0, x - r)
        sum += current[rowOffset + nextX] - current[rowOffset + prevX]
      }
    }

    // 垂直 pass
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let y = -r; y <= r; y++) {
        const clampedY = Math.min(height - 1, Math.max(0, y))
        sum += temp[clampedY * width + x]
      }
      for (let y = 0; y < height; y++) {
        current[y * width + x] = sum / (2 * r + 1)
        const nextY = Math.min(height - 1, y + r + 1)
        const prevY = Math.max(0, y - r)
        sum += temp[nextY * width + x] - temp[prevY * width + x]
      }
    }
  }

  for (let i = 0; i < length; i++) {
    result[i] = Math.max(0, Math.min(1, current[i]))
  }

  return result
}

export interface HarmonizeOptions {
  /** 調和強度：0 ~ 1（預設 0.85） */
  strength: number
  /** 保留原始立體光影程度：0 ~ 1（預設 0.85；越接近 1，越鎖定原始明暗，僅調色相/底色） */
  preserveLighting: number
  /** 邊緣羽化半徑 (px) */
  featherRadius: number
}

/**
 * 執行膚色調和
 * @param sourceCanvas 原圖畫布
 * @param targetMaskCanvas 目標調整區域遮罩（白色不透明筆刷處為調整區）
 * @param refStats 參考膚色的統計值（均值與標準差）
 * @param options 調和選項
 */
export function harmonizeSkinTone(
  sourceCanvas: HTMLCanvasElement,
  targetMaskCanvas: HTMLCanvasElement,
  refStats: LabStats,
  options: HarmonizeOptions,
): HTMLCanvasElement {
  const w = sourceCanvas.width
  const h = sourceCanvas.height
  const totalPixels = w * h

  const srcCtx = sourceCanvas.getContext('2d')!
  const srcImgData = srcCtx.getImageData(0, 0, w, h)
  const srcPixels = srcImgData.data

  const maskCtx = targetMaskCanvas.getContext('2d')!
  const maskImgData = maskCtx.getImageData(0, 0, w, h)
  const maskPixels = maskImgData.data

  // 1. 抽取原圖 OKLab
  const labArray = new Float32Array(totalPixels * 3)
  for (let i = 0; i < totalPixels; i++) {
    const p = i * 4
    const [L, a, b] = rgbToOklab(srcPixels[p], srcPixels[p + 1], srcPixels[p + 2])
    const lp = i * 3
    labArray[lp] = L
    labArray[lp + 1] = a
    labArray[lp + 2] = b
  }

  // 2. 收集目標遮罩內的像素索引（用於計算目標原本膚色的統計值）
  const maskAlpha = new Uint8Array(totalPixels)
  const targetIndices: number[] = []
  for (let i = 0; i < totalPixels; i++) {
    const alpha = maskPixels[i * 4 + 3]
    maskAlpha[i] = alpha
    if (alpha > 30) {
      targetIndices.push(i)
    }
  }

  // 若目標遮罩完全為空，直接返回原圖拷貝
  if (targetIndices.length === 0) {
    const outCanvas = document.createElement('canvas')
    outCanvas.width = w
    outCanvas.height = h
    outCanvas.getContext('2d')!.drawImage(sourceCanvas, 0, 0)
    return outCanvas
  }

  // 3. 計算目標區域原本的 OKLab 統計值
  const tgtStats = computeLabStats(labArray, targetIndices)

  // 4. 羽化遮罩
  const featheredMask = featherMask(maskAlpha, w, h, options.featherRadius)

  // 5. Reinhard 色彩轉移與加權融合
  const scaleL = Math.min(2.0, Math.max(0.5, refStats.stdL / tgtStats.stdL))
  const scaleA = Math.min(2.0, Math.max(0.5, refStats.stdA / tgtStats.stdA))
  const scaleB = Math.min(2.0, Math.max(0.5, refStats.stdB / tgtStats.stdB))

  const outCanvas = document.createElement('canvas')
  outCanvas.width = w
  outCanvas.height = h
  const outCtx = outCanvas.getContext('2d')!
  const outImgData = outCtx.createImageData(w, h)
  const outPixels = outImgData.data

  const { strength, preserveLighting } = options

  for (let i = 0; i < totalPixels; i++) {
    const p = i * 4
    const weight = featheredMask[i] * strength

    if (weight <= 0.001) {
      outPixels[p] = srcPixels[p]
      outPixels[p + 1] = srcPixels[p + 1]
      outPixels[p + 2] = srcPixels[p + 2]
      outPixels[p + 3] = srcPixels[p + 3]
      continue
    }

    const lp = i * 3
    const origL = labArray[lp]
    const origA = labArray[lp + 1]
    const origB = labArray[lp + 2]

    // Reinhard 轉移計算
    const shiftedL = (origL - tgtStats.meanL) * scaleL + refStats.meanL
    const shiftedA = (origA - tgtStats.meanA) * scaleA + refStats.meanA
    const shiftedB = (origB - tgtStats.meanB) * scaleB + refStats.meanB

    // 保留原始光影：如果 preserveLighting 高，大部分亮度保留原圖，僅適當調整平均亮度差異
    const targetL = (1 - preserveLighting) * shiftedL + preserveLighting * (origL + (refStats.meanL - tgtStats.meanL) * 0.35)

    // 依羽化權重與強度進行線性插值融合
    const finalL = origL + weight * (targetL - origL)
    const finalA = origA + weight * (shiftedA - origA)
    const finalB = origB + weight * (shiftedB - origB)

    const [r, g, b] = oklabToRgb(finalL, finalA, finalB)
    outPixels[p] = r
    outPixels[p + 1] = g
    outPixels[p + 2] = b
    outPixels[p + 3] = srcPixels[p + 3]
  }

  outCtx.putImageData(outImgData, 0, 0)
  return outCanvas
}

/**
 * 在原圖上以指定座標半徑進行圓形取樣，計算參考膚色統計
 */
export function sampleSkinToneAt(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  radius = 8,
): { stats: LabStats; previewRgb: [number, number, number]; hex: string } {
  const w = canvas.width
  const h = canvas.height
  const ctx = canvas.getContext('2d')!

  const startX = Math.max(0, Math.floor(x - radius))
  const startY = Math.max(0, Math.floor(y - radius))
  const endX = Math.min(w - 1, Math.ceil(x + radius))
  const endY = Math.min(h - 1, Math.ceil(y + radius))

  const sampleW = Math.max(1, endX - startX + 1)
  const sampleH = Math.max(1, endY - startY + 1)
  const imgData = ctx.getImageData(startX, startY, sampleW, sampleH)
  const data = imgData.data

  const labList: Float32Array = new Float32Array(sampleW * sampleH * 3)
  const validIndices: number[] = []

  let rSum = 0
  let gSum = 0
  let bSum = 0
  let count = 0

  const r2 = radius * radius
  for (let py = 0; py < sampleH; py++) {
    for (let px = 0; px < sampleW; px++) {
      const curX = startX + px
      const curY = startY + py
      const dx = curX - x
      const dy = curY - y
      if (dx * dx + dy * dy <= r2) {
        const p = (py * sampleW + px) * 4
        const r = data[p]
        const g = data[p + 1]
        const b = data[p + 2]
        rSum += r
        gSum += g
        bSum += b
        count++

        const [L, a_val, b_val] = rgbToOklab(r, g, b)
        const idx = py * sampleW + px
        labList[idx * 3] = L
        labList[idx * 3 + 1] = a_val
        labList[idx * 3 + 2] = b_val
        validIndices.push(idx)
      }
    }
  }

  const avgR = count > 0 ? Math.round(rSum / count) : 210
  const avgG = count > 0 ? Math.round(gSum / count) : 170
  const avgB = count > 0 ? Math.round(bSum / count) : 150

  const hex = `#${avgR.toString(16).padStart(2, '0')}${avgG.toString(16).padStart(2, '0')}${avgB.toString(16).padStart(2, '0')}`

  const stats = computeLabStats(labList, validIndices)
  return {
    stats,
    previewRgb: [avgR, avgG, avgB],
    hex,
  }
}

/**
 * 從指定遮罩區域計算膚色統計（用於 AI 自動分離之臉部或身體區域）
 */
export function sampleSkinToneFromMask(
  sourceCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
): { stats: LabStats; previewRgb: [number, number, number]; hex: string } {
  const w = sourceCanvas.width
  const h = sourceCanvas.height
  const totalPixels = w * h

  const srcCtx = sourceCanvas.getContext('2d')!
  const srcData = srcCtx.getImageData(0, 0, w, h).data

  const maskCtx = maskCanvas.getContext('2d')!
  const maskData = maskCtx.getImageData(0, 0, w, h).data

  const labList = new Float32Array(totalPixels * 3)
  const validIndices: number[] = []

  let rSum = 0
  let gSum = 0
  let bSum = 0

  for (let i = 0; i < totalPixels; i++) {
    const p = i * 4
    const r = srcData[p]
    const g = srcData[p + 1]
    const b = srcData[p + 2]
    const [L, a_val, b_val] = rgbToOklab(r, g, b)

    labList[i * 3] = L
    labList[i * 3 + 1] = a_val
    labList[i * 3 + 2] = b_val

    if (maskData[p + 3] > 60) {
      validIndices.push(i)
      rSum += r
      gSum += g
      bSum += b
    }
  }

  const count = validIndices.length
  const avgR = count > 0 ? Math.round(rSum / count) : 210
  const avgG = count > 0 ? Math.round(gSum / count) : 170
  const avgB = count > 0 ? Math.round(bSum / count) : 150
  const hex = `#${avgR.toString(16).padStart(2, '0')}${avgG.toString(16).padStart(2, '0')}${avgB.toString(16).padStart(2, '0')}`

  const stats = computeLabStats(labList, validIndices)
  return {
    stats,
    previewRgb: [avgR, avgG, avgB],
    hex,
  }
}

