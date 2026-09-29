/**
 * 全自動 AI 換頭渲染核心管線 (100% 瀏覽器本機 WebAssembly/Canvas 運算)
 */
import type { HeadExtractionResult, TargetHeadAnalysis } from './mediapipe'
import { harmonizeSkinTone } from './colorTransfer'

export interface HeadSwapConfig {
  /** 頭部縮放倍率 (預設 1.0 即自動吻合身型) */
  scale: number
  /** 水平位置微調 (px) */
  offsetX: number
  /** 垂直位置微調 (px) */
  offsetY: number
  /** 旋轉角度 (度數 -30 ~ +30) */
  rotation: number
  /** 頸部邊緣羽化程度 (px 0 ~ 40) */
  feather: number
  /** 是否開啟自動膚色與光影調和 */
  harmonizeSkin: boolean
  /** 膚色融合強度 (0.0 ~ 1.0) */
  harmonizeStrength: number
}

export const DEFAULT_HEAD_SWAP_CONFIG: HeadSwapConfig = {
  scale: 1.0,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  feather: 14,
  harmonizeSkin: true,
  harmonizeStrength: 0.85,
}

/**
 * 預先計算並調和膚色之頭像畫布 (耗時計算獨立執行並快取)
 */
export function prepareHarmonizedHead(
  headCanvas: HTMLCanvasElement,
  targetAnalysis: TargetHeadAnalysis,
  config: HeadSwapConfig,
): HTMLCanvasElement {
  if (!config.harmonizeSkin || !targetAnalysis.bodySkinStats) {
    return headCanvas
  }
  try {
    const dummyMask = document.createElement('canvas')
    dummyMask.width = headCanvas.width
    dummyMask.height = headCanvas.height
    const dmCtx = dummyMask.getContext('2d')!
    dmCtx.fillStyle = '#fff'
    dmCtx.fillRect(0, 0, dummyMask.width, dummyMask.height)

    return harmonizeSkinTone(
      headCanvas,
      dummyMask,
      targetAnalysis.bodySkinStats,
      {
        strength: config.harmonizeStrength,
        preserveLighting: 0.85,
        featherRadius: config.feather,
      },
    )
  } catch (e) {
    console.warn('Skin tone harmonization fallback', e)
    return headCanvas
  }
}

/**
 * 執行高畫質換頭合成渲染 (極速 GPU 矩陣運算，無重複分配與耗時濾鏡)
 */
export function renderHeadSwap(
  targetImage: HTMLImageElement | HTMLCanvasElement,
  headResult: HeadExtractionResult,
  targetAnalysis: TargetHeadAnalysis,
  config: HeadSwapConfig,
  preHarmonizedHead?: HTMLCanvasElement,
): HTMLCanvasElement {
  const targetW = (targetImage as HTMLImageElement).naturalWidth ?? (targetImage as HTMLCanvasElement).width
  const targetH = (targetImage as HTMLImageElement).naturalHeight ?? (targetImage as HTMLCanvasElement).height

  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = targetW
  outputCanvas.height = targetH
  const ctx = outputCanvas.getContext('2d')!

  // 1. 繪製目標底圖 (Image B)
  ctx.drawImage(targetImage, 0, 0, targetW, targetH)

  // 2. 準備頭像畫布 (優先使用已快取之調和畫布)
  const headCanvas = preHarmonizedHead || prepareHarmonizedHead(headResult.headCanvas, targetAnalysis, config)

  // 3. 計算幾何縮放比例
  const baseScale = targetAnalysis.hasHead && headResult.headBox.width > 0
    ? (targetAnalysis.headBox.width / headResult.headBox.width)
    : (targetW * 0.38) / Math.max(1, headResult.headBox.width)

  const finalScale = baseScale * config.scale

  // 4. 來源頭部中心錨點與目標貼合座標
  const srcHeadCenterX = headResult.headBox.x + headResult.headBox.width / 2
  const srcHeadCenterY = headResult.headBox.y + headResult.headBox.height / 2
  const destCenterX = targetAnalysis.center.x + config.offsetX
  const destCenterY = targetAnalysis.center.y + config.offsetY

  // 5. 疊加圖 A 頭部（平移、旋轉、縮放）
  ctx.save()
  ctx.translate(destCenterX, destCenterY)
  if (config.rotation !== 0) {
    ctx.rotate((config.rotation * Math.PI) / 180)
  }
  ctx.scale(finalScale, finalScale)
  ctx.drawImage(headCanvas, -srcHeadCenterX, -srcHeadCenterY)
  ctx.restore()

  return outputCanvas
}
