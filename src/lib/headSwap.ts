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
 * 執行即時畫布換頭渲染
 */
export function renderHeadSwap(
  targetImage: HTMLImageElement | HTMLCanvasElement,
  headResult: HeadExtractionResult,
  targetAnalysis: TargetHeadAnalysis,
  config: HeadSwapConfig,
): HTMLCanvasElement {
  const targetW = (targetImage as HTMLImageElement).naturalWidth ?? (targetImage as HTMLCanvasElement).width
  const targetH = (targetImage as HTMLImageElement).naturalHeight ?? (targetImage as HTMLCanvasElement).height

  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = targetW
  outputCanvas.height = targetH
  const ctx = outputCanvas.getContext('2d')!

  // 1. 繪製目標底圖 (Image B)
  ctx.drawImage(targetImage, 0, 0, targetW, targetH)

  // 2. 準備頭像畫布 (Image A)
  let headCanvas = headResult.headCanvas

  // 3. 膚色與光影調和 (若開啟且目標有膚色資訊)
  if (config.harmonizeSkin && targetAnalysis.bodySkinStats) {
    try {
      const dummyMask = document.createElement('canvas')
      dummyMask.width = headCanvas.width
      dummyMask.height = headCanvas.height
      const dmCtx = dummyMask.getContext('2d')!
      dmCtx.fillStyle = '#fff'
      dmCtx.fillRect(0, 0, dummyMask.width, dummyMask.height)

      headCanvas = harmonizeSkinTone(
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
    }
  }

  // 4. 計算自動幾何縮放比例
  // 以目標頭部寬度除以來源頭部寬度作為基準縮放比
  const baseScale = targetAnalysis.hasHead && headResult.headBox.width > 0
    ? (targetAnalysis.headBox.width / headResult.headBox.width)
    : (targetW * 0.38) / Math.max(1, headResult.headBox.width)

  const finalScale = baseScale * config.scale

  // 來源頭部中心錨點
  const srcHeadCenterX = headResult.headBox.x + headResult.headBox.width / 2
  const srcHeadCenterY = headResult.headBox.y + headResult.headBox.height / 2

  // 目標貼合中心座標
  const destCenterX = targetAnalysis.center.x + config.offsetX
  const destCenterY = targetAnalysis.center.y + config.offsetY

  // 5. 疊加圖 A 頭部（平移、旋轉、縮放）
  ctx.save()
  ctx.translate(destCenterX, destCenterY)
  if (config.rotation !== 0) {
    ctx.rotate((config.rotation * Math.PI) / 180)
  }
  ctx.scale(finalScale, finalScale)

  // 邊緣微光影柔化
  if (config.feather > 0) {
    ctx.filter = `drop-shadow(0 0 ${Math.round(config.feather * 0.25)}px rgba(0,0,0,0.15))`
  }

  ctx.drawImage(headCanvas, -srcHeadCenterX, -srcHeadCenterY)
  ctx.restore()

  return outputCanvas
}
