/**
 * 克隆圖章 (Clone Stamp) 核心演算法與繪製引擎
 * 支援大小調節、柔邊 (Feathering / 邊緣羽化)、不透明度、鏡像翻轉 (Flip)、旋轉角度 (Rotation)、連動對齊與手機觸控最佳化。
 */

export interface Point {
  x: number
  y: number
}

export interface CloneStampTransform {
  /** 水平鏡像翻轉 */
  flipH?: boolean
  /** 垂直鏡像翻轉 */
  flipV?: boolean
  /** 旋轉角度 (-180° ~ 180°) */
  angle?: number
}

export interface CloneStampOptions {
  /** 筆刷直徑 (px) */
  size: number
  /** 柔邊程度 0 ~ 1 (0: 100% 硬邊, 1: 100% 柔邊/羽化) */
  feather: number
  /** 不透明度 0.1 ~ 1.0 */
  opacity: number
  /** 是否開啟連動對齊模式 */
  aligned: boolean
  /** 鏡像翻轉與旋轉變形參數 */
  transform?: CloneStampTransform
}

/**
 * 依據旋轉角度與鏡像翻轉，將目標移動量映射至來源取樣點的位移量
 * 確保塗抹筆劃時，鏡像與旋轉效果在筆劃軌跡上連續且無縫平滑
 */
export function calculateSourceOffset(
  deltaTarget: Point,
  transform?: CloneStampTransform,
): Point {
  const flipH = transform?.flipH ? -1 : 1
  const flipV = transform?.flipV ? -1 : 1
  const angleDeg = transform?.angle || 0
  const rad = (angleDeg * Math.PI) / 180

  // 1. 鏡像翻轉
  const dx = deltaTarget.x * flipH
  const dy = deltaTarget.y * flipV

  // 2. 角度旋轉
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const sx = dx * cos - dy * sin
  const sy = dx * sin + dy * cos

  return { x: sx, y: sy }
}

/**
 * 建立平滑的餘弦過渡羽化放射漸層
 * 比單純線性漸層更貼近 Photoshop 高斯柔邊效果，邊緣融合自然無痕
 */
function createFeatherGradient(
  ctx: CanvasRenderingContext2D,
  radius: number,
  feather: number,
): CanvasGradient {
  const grad = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius)
  if (feather <= 0.02) {
    // 硬邊 (微幅抗鋸齒)
    grad.addColorStop(0, 'rgba(0, 0, 0, 1)')
    grad.addColorStop(0.98, 'rgba(0, 0, 0, 1)')
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)')
    return grad
  }

  // 柔邊：內圈保持 100% 不透明，向外以平滑曲線遞減
  const inner = Math.max(0, 1 - feather)
  grad.addColorStop(0, 'rgba(0, 0, 0, 1)')
  if (inner > 0) {
    grad.addColorStop(inner, 'rgba(0, 0, 0, 1)')
  }

  // 以餘弦函數取 4 個平滑採樣點: 0.5 * (1 + cos(pi * t))
  const steps = 4
  for (let i = 1; i <= steps; i++) {
    const t = i / (steps + 1)
    const stop = inner + (1 - inner) * t
    const alpha = 0.5 * (1 + Math.cos(Math.PI * t))
    grad.addColorStop(stop, `rgba(0, 0, 0, ${alpha.toFixed(3)})`)
  }

  grad.addColorStop(1, 'rgba(0, 0, 0, 0)')
  return grad
}

/**
 * 安全裁切複製來源區域（防止邊界座標在 iOS/Android WebView 拋出 IndexSizeError）
 */
function drawSourcePatchSafely(
  targetCtx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  sx: number,
  sy: number,
  radius: number,
  diameter: number,
) {
  const srcW = sourceCanvas.width
  const srcH = sourceCanvas.height

  const srcX0 = sx - radius
  const srcY0 = sy - radius

  // 計算與來源畫布邊界的交集矩形
  const clampX0 = Math.max(0, Math.min(srcW, srcX0))
  const clampY0 = Math.max(0, Math.min(srcH, srcY0))
  const clampX1 = Math.max(0, Math.min(srcW, srcX0 + diameter))
  const clampY1 = Math.max(0, Math.min(srcH, srcY0 + diameter))

  const validW = clampX1 - clampX0
  const validH = clampY1 - clampY0

  if (validW <= 0 || validH <= 0) return

  // 映射至筆刷畫布內的相對目標位置
  const dstX = clampX0 - srcX0
  const dstY = clampY0 - srcY0

  targetCtx.drawImage(
    sourceCanvas,
    clampX0, clampY0, validW, validH,
    dstX, dstY, validW, validH,
  )
}

export class CloneStampEngine {
  private brushCanvas: HTMLCanvasElement
  private brushCtx: CanvasRenderingContext2D

  constructor() {
    this.brushCanvas = document.createElement('canvas')
    this.brushCtx = this.brushCanvas.getContext('2d')!
  }

  /**
   * 繪製單個羽化圓形克隆印記（支援鏡像與旋轉）
   */
  stampDab(
    sourceCanvas: HTMLCanvasElement,
    targetCanvas: HTMLCanvasElement,
    sourceCenter: Point,
    targetCenter: Point,
    radius: number,
    feather: number,
    opacity: number,
    transform?: CloneStampTransform,
  ) {
    if (radius <= 0) return
    const diameter = Math.max(2, Math.ceil(radius * 2))

    if (this.brushCanvas.width !== diameter || this.brushCanvas.height !== diameter) {
      this.brushCanvas.width = diameter
      this.brushCanvas.height = diameter
    }
    const bCtx = this.brushCtx
    bCtx.clearRect(0, 0, diameter, diameter)

    // 1. 安全抓取來源紋理切片至臨時筆刷畫布
    drawSourcePatchSafely(bCtx, sourceCanvas, sourceCenter.x, sourceCenter.y, radius, diameter)

    // 2. 利用 destination-in 套用柔邊羽化遮罩（圓形遮罩具備對稱性）
    bCtx.save()
    bCtx.globalCompositeOperation = 'destination-in'
    bCtx.fillStyle = createFeatherGradient(bCtx, radius, feather)
    bCtx.beginPath()
    bCtx.arc(radius, radius, radius, 0, Math.PI * 2)
    bCtx.fill()
    bCtx.restore()

    // 3. 合成至目標影像畫布（套用鏡像縮放與旋轉）
    const tCtx = targetCanvas.getContext('2d')!
    tCtx.save()
    tCtx.globalAlpha = Math.max(0.01, Math.min(1, opacity))
    tCtx.globalCompositeOperation = 'source-over'

    // 平移至目標中心點
    tCtx.translate(targetCenter.x, targetCenter.y)

    const angleDeg = transform?.angle || 0
    if (angleDeg !== 0) {
      tCtx.rotate((angleDeg * Math.PI) / 180)
    }

    const flipH = !!transform?.flipH
    const flipV = !!transform?.flipV
    if (flipH || flipV) {
      tCtx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
    }

    tCtx.drawImage(this.brushCanvas, -radius, -radius)
    tCtx.restore()
  }

  /**
   * 平滑路徑插值並連續印製筆觸（支援鏡像與旋轉連續取樣）
   */
  strokeSegment(
    sourceCanvas: HTMLCanvasElement,
    targetCanvas: HTMLCanvasElement,
    prevTarget: Point,
    currTarget: Point,
    strokeStartTarget: Point,
    strokeStartSource: Point,
    radius: number,
    feather: number,
    opacity: number,
    transform?: CloneStampTransform,
  ) {
    const dist = Math.hypot(currTarget.x - prevTarget.x, currTarget.y - prevTarget.y)
    // 步進距離：半徑的 15%~20%，避免過密影響效能或過疏出現跳點
    const step = Math.max(1, radius * 0.18)
    const steps = Math.max(1, Math.ceil(dist / step))

    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const tx = prevTarget.x + (currTarget.x - prevTarget.x) * t
      const ty = prevTarget.y + (currTarget.y - prevTarget.y) * t

      // 計算相對於筆劃起點的目標位移
      const deltaTarget = {
        x: tx - strokeStartTarget.x,
        y: ty - strokeStartTarget.y,
      }
      // 根據鏡像與旋轉映射至來源位移
      const deltaSource = calculateSourceOffset(deltaTarget, transform)
      const sx = strokeStartSource.x + deltaSource.x
      const sy = strokeStartSource.y + deltaSource.y

      this.stampDab(
        sourceCanvas,
        targetCanvas,
        { x: sx, y: sy },
        { x: tx, y: ty },
        radius,
        feather,
        opacity,
        transform,
      )
    }
  }

  /**
   * 繪製高辨識度取樣點準星錨點 (支援手機直接按壓拖曳與變形標籤)
   */
  drawSourceMarker(
    ctx: CanvasRenderingContext2D,
    point: Point,
    scaleX: number,
    scaleY: number,
    isDragging = false,
    transform?: CloneStampTransform,
  ) {
    const x = point.x * scaleX
    const y = point.y * scaleY

    ctx.save()

    // 1. 手機觸控熱區指示圈 (半透明呼吸光暈)
    ctx.beginPath()
    ctx.arc(x, y, isDragging ? 28 : 22, 0, Math.PI * 2)
    ctx.fillStyle = isDragging ? 'rgba(56, 189, 248, 0.25)' : 'rgba(79, 140, 255, 0.15)'
    ctx.fill()
    ctx.strokeStyle = isDragging ? 'rgba(56, 189, 248, 0.8)' : 'rgba(255, 255, 255, 0.5)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([3, 3])
    ctx.stroke()
    ctx.setLineDash([])

    // 2. 雙層高對比準星主體 (在黑白兩色背景均清晰可見)
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)'
    ctx.shadowBlur = 4

    // 外環
    ctx.beginPath()
    ctx.arc(x, y, 12, 0, Math.PI * 2)
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 3.5
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(x, y, 12, 0, Math.PI * 2)
    ctx.strokeStyle = isDragging ? '#38bdf8' : '#ffffff'
    ctx.lineWidth = 2
    ctx.stroke()

    // 十字刻度
    const arms: [number, number, number, number][] = [
      [x - 18, y, x - 5, y],
      [x + 5, y, x + 18, y],
      [x, y - 18, x, y - 5],
      [x, y + 5, x, y + 18],
    ]

    for (const [x1, y1, x2, y2] of arms) {
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.strokeStyle = '#000000'
      ctx.lineWidth = 3
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.strokeStyle = isDragging ? '#38bdf8' : '#ffffff'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    // 中心點
    ctx.beginPath()
    ctx.arc(x, y, 2.5, 0, Math.PI * 2)
    ctx.fillStyle = isDragging ? '#38bdf8' : '#ffffff'
    ctx.fill()

    // 3. 標籤膠囊 (提示取樣點、鏡像與旋轉角度)
    const angleDeg = transform?.angle || 0
    const flipH = !!transform?.flipH
    const flipV = !!transform?.flipV
    const transTags = [
      flipH ? '↔' : '',
      flipV ? '↕' : '',
      angleDeg !== 0 ? `${angleDeg}°` : '',
    ].filter(Boolean).join(' ')

    const label = isDragging
      ? '🎯 移動中…'
      : transTags
        ? `🎯 取樣點 (${transTags})`
        : '🎯 取樣點'

    ctx.font = 'bold 11px system-ui, sans-serif'
    const textMetrics = ctx.measureText(label)
    const paddingX = 7
    const badgeW = textMetrics.width + paddingX * 2
    const badgeH = 20
    const badgeX = x - badgeW / 2
    const badgeY = y - 36

    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)'
    ctx.beginPath()
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6)
    ctx.fill()
    ctx.strokeStyle = isDragging ? '#38bdf8' : 'rgba(255, 255, 255, 0.3)'
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x, badgeY + badgeH / 2)

    ctx.restore()
  }

  /**
   * 繪製目標筆刷預覽圈（包含柔邊邊界與鏡像/旋轉指向）
   */
  drawBrushPreview(
    ctx: CanvasRenderingContext2D,
    target: Point,
    scaleX: number,
    scaleY: number,
    radius: number,
    feather: number,
    transform?: CloneStampTransform,
  ) {
    const x = target.x * scaleX
    const y = target.y * scaleY
    const r = radius * scaleX

    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
    ctx.shadowBlur = 3

    // 1. 外圈（筆刷最大外緣）
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 2.5
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.stroke()

    // 2. 內圈（100% 實心範圍邊界，提示柔邊過渡寬度）
    if (feather > 0.05) {
      const innerR = r * Math.max(0, 1 - feather)
      if (innerR > 1.5) {
        ctx.beginPath()
        ctx.arc(x, y, innerR, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)'
        ctx.lineWidth = 1.2
        ctx.setLineDash([3, 3])
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    // 3. 角度旋轉指向與鏡像視覺標示
    const angleDeg = transform?.angle || 0
    const flipH = !!transform?.flipH
    const flipV = !!transform?.flipV

    if (angleDeg !== 0 || flipH || flipV) {
      const rad = (angleDeg * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const arrowLen = Math.max(8, r * 0.75)

      // 箭頭方向中心線
      ctx.beginPath()
      ctx.moveTo(x - arrowLen * 0.4 * cos, y - arrowLen * 0.4 * sin)
      ctx.lineTo(x + arrowLen * cos, y + arrowLen * sin)
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 2
      ctx.stroke()

      // 箭頭尖端
      const tipX = x + arrowLen * cos
      const tipY = y + arrowLen * sin
      const headLen = 6
      ctx.beginPath()
      ctx.moveTo(tipX, tipY)
      ctx.lineTo(
        tipX - headLen * Math.cos(rad - Math.PI / 6),
        tipY - headLen * Math.sin(rad - Math.PI / 6),
      )
      ctx.moveTo(tipX, tipY)
      ctx.lineTo(
        tipX - headLen * Math.cos(rad + Math.PI / 6),
        tipY - headLen * Math.sin(rad + Math.PI / 6),
      )
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 2
      ctx.stroke()

      // 鏡像標籤標示在筆刷圈外側
      if (flipH || flipV) {
        ctx.font = 'bold 10px system-ui, sans-serif'
        ctx.fillStyle = '#38bdf8'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        const mirrorTag = (flipH ? '↔' : '') + (flipV ? '↕' : '')
        ctx.fillText(mirrorTag, x, y - r - 3)
      }
    } else {
      // 中心微十字
      ctx.beginPath()
      ctx.arc(x, y, 1.5, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
    }

    ctx.restore()
  }

  /**
   * 繪製塗抹中的連線與即時來源十字線
   */
  drawActiveStampLink(
    ctx: CanvasRenderingContext2D,
    source: Point,
    target: Point,
    scaleX: number,
    scaleY: number,
  ) {
    const sx = source.x * scaleX
    const sy = source.y * scaleY
    const tx = target.x * scaleX
    const ty = target.y * scaleY

    ctx.save()
    // 虛線連接來源與目標
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(tx, ty)
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)'
    ctx.lineWidth = 1.2
    ctx.setLineDash([4, 4])
    ctx.stroke()
    ctx.restore()
  }
}
