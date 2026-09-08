import { useCallback, useEffect, useRef, useState } from 'react'

const MIN_BRUSH = 5
const MAX_BRUSH = 100
/** 復原上限步數 */
const MAX_UNDO = 30

interface Point {
  x: number
  y: number
}

/** 單一筆劃（座標為原圖原始解析度） */
interface Stroke {
  points: Point[]
  radius: number
  erase: boolean
}

interface MaskEditorProps {
  image: HTMLImageElement
  /** 原圖解析度的 mask 畫布（由 App 持有，跨階段保留） */
  maskCanvas: HTMLCanvasElement
  onProcess: () => void
  onBack: () => void
}

/** 在 ctx 上重放一筆（圓形筆刷 + 線段間補圓避免斷線） */
function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  if (stroke.points.length === 0) return
  ctx.save()
  ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over'
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = stroke.radius * 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const [first, ...rest] = stroke.points
  // 起點補圓
  ctx.beginPath()
  ctx.arc(first.x, first.y, stroke.radius, 0, Math.PI * 2)
  ctx.fill()
  if (rest.length > 0) {
    ctx.beginPath()
    ctx.moveTo(first.x, first.y)
    let prev = first
    for (const p of rest) {
      ctx.lineTo(p.x, p.y)
      prev = p
    }
    ctx.stroke()
    // 終點補圓，確保轉折與收尾連續
    ctx.beginPath()
    ctx.arc(prev.x, prev.y, stroke.radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** 抽查 mask 畫布是否已有內容（每 16 px 取樣一次） */
function maskHasContent(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d')
  if (!ctx || canvas.width === 0) return false
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (let y = 0; y < height; y += 16) {
    for (let x = 0; x < width; x += 16) {
      if (data[(y * width + x) * 4 + 3] > 0) return true
    }
  }
  return false
}

export default function MaskEditor({ image, maskCanvas, onProcess, onBack }: MaskEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const baseCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const strokesRef = useRef<Stroke[]>([])
  const drawingRef = useRef(false)
  const currentStrokeRef = useRef<Stroke | null>(null)
  const lastPointRef = useRef<Point | null>(null)

  const [brushSize, setBrushSize] = useState(30)
  const [eraser, setEraser] = useState(false)
  const [strokeCount, setStrokeCount] = useState(0)
  // 掛載時若 mask 已有內容（例如從結果頁返回），直接啟用處理按鈕
  const [hasMask, setHasMask] = useState(() => maskHasContent(maskCanvas))
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 })

  const imgW = image.naturalWidth
  const imgH = image.naturalHeight

  /** 依容器寬度計算顯示尺寸（等比縮放） */
  const updateDisplaySize = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const w = container.clientWidth
    if (w <= 0) return
    setDisplaySize({ w, h: Math.round((w * imgH) / imgW) })
  }, [imgW, imgH])

  useEffect(() => {
    updateDisplaySize()
    const observer = new ResizeObserver(updateDisplaySize)
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [updateDisplaySize])

  /** 重繪底層原圖 */
  useEffect(() => {
    const base = baseCanvasRef.current
    if (!base || displaySize.w === 0) return
    base.width = displaySize.w
    base.height = displaySize.h
    const ctx = base.getContext('2d')!
    ctx.drawImage(image, 0, 0, displaySize.w, displaySize.h)
  }, [image, displaySize])

  /** 重繪上層 mask（縮放後以半透明紅色顯示） */
  const redrawOverlay = useCallback(() => {
    const overlay = overlayCanvasRef.current
    if (!overlay || displaySize.w === 0) return
    if (overlay.width !== displaySize.w || overlay.height !== displaySize.h) {
      overlay.width = displaySize.w
      overlay.height = displaySize.h
    }
    const ctx = overlay.getContext('2d')!
    ctx.clearRect(0, 0, overlay.width, overlay.height)
    ctx.drawImage(maskCanvas, 0, 0, overlay.width, overlay.height)
    ctx.globalCompositeOperation = 'source-in'
    ctx.fillStyle = 'rgba(255, 60, 60, 0.5)'
    ctx.fillRect(0, 0, overlay.width, overlay.height)
    ctx.globalCompositeOperation = 'source-over'
  }, [maskCanvas, displaySize])

  useEffect(() => {
    redrawOverlay()
  }, [redrawOverlay])

  /** 將 pointer 事件的 client 座標換算成原圖解析度座標 */
  const toImageCoords = (e: React.PointerEvent): Point | null => {
    const overlay = overlayCanvasRef.current
    if (!overlay) return null
    const rect = overlay.getBoundingClientRect()
    if (rect.width === 0) return null
    return {
      x: ((e.clientX - rect.left) / rect.width) * imgW,
      y: ((e.clientY - rect.top) / rect.height) * imgH,
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const p = toImageCoords(e)
    if (!p) return
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drawingRef.current = true
    const stroke: Stroke = { points: [p], radius: brushSize / 2, erase: eraser }
    currentStrokeRef.current = stroke
    lastPointRef.current = p
    const ctx = maskCanvas.getContext('2d')!
    drawStroke(ctx, stroke)
    redrawOverlay()
    setHasMask(true)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return
    const stroke = currentStrokeRef.current
    const last = lastPointRef.current
    if (!stroke || !last) return
    // 觸控裝置可取用 coalesced events，讓快速滑動更平滑
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
    const ctx = maskCanvas.getContext('2d')!
    let prev = last
    for (const ev of events) {
      const rect = overlayCanvasRef.current!.getBoundingClientRect()
      const p: Point = {
        x: ((ev.clientX - rect.left) / rect.width) * imgW,
        y: ((ev.clientY - rect.top) / rect.height) * imgH,
      }
      const segment: Stroke = { points: [prev, p], radius: stroke.radius, erase: stroke.erase }
      drawStroke(ctx, segment)
      stroke.points.push(p)
      prev = p
    }
    lastPointRef.current = prev
    redrawOverlay()
  }

  const finishStroke = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    const stroke = currentStrokeRef.current
    currentStrokeRef.current = null
    lastPointRef.current = null
    if (stroke && stroke.points.length > 0) {
      strokesRef.current.push(stroke)
      // 超過上限時丟棄最舊的一步
      if (strokesRef.current.length > MAX_UNDO) strokesRef.current.shift()
      setStrokeCount(strokesRef.current.length)
    }
  }

  const undo = () => {
    const strokes = strokesRef.current
    if (strokes.length === 0) return
    strokes.pop()
    setStrokeCount(strokes.length)
    // 清空後重放剩餘筆劃
    const ctx = maskCanvas.getContext('2d')!
    ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
    for (const s of strokes) drawStroke(ctx, s)
    if (strokes.length === 0) setHasMask(maskHasContent(maskCanvas))
    redrawOverlay()
  }

  const clearAll = () => {
    strokesRef.current = []
    setStrokeCount(0)
    setHasMask(false)
    const ctx = maskCanvas.getContext('2d')!
    ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
    redrawOverlay()
  }

  return (
    <div className="mask-editor">
      <div className="toolbar">
        <label className="brush-control">
          筆刷大小
          <input
            type="range"
            min={MIN_BRUSH}
            max={MAX_BRUSH}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
          />
          <span className="brush-value">{brushSize}px</span>
        </label>
        <div className="toolbar-buttons">
          <button
            type="button"
            className={eraser ? 'active' : ''}
            onClick={() => setEraser((v) => !v)}
          >
            {eraser ? '橡皮擦（使用中）' : '橡皮擦'}
          </button>
          <button type="button" onClick={undo} disabled={strokeCount === 0}>
            復原
          </button>
          <button type="button" onClick={clearAll} disabled={!hasMask}>
            清除全部
          </button>
        </div>
      </div>

      <div ref={containerRef} className="canvas-container">
        <div
          className="canvas-stack"
          style={{ width: displaySize.w || undefined, height: displaySize.h || undefined }}
        >
          <canvas ref={baseCanvasRef} className="base-canvas" />
          <canvas
            ref={overlayCanvasRef}
            className={`overlay-canvas${eraser ? ' erasing' : ''}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finishStroke}
            onPointerCancel={finishStroke}
          />
        </div>
      </div>

      <div className="action-bar">
        <button type="button" className="secondary" onClick={onBack}>
          換一張圖片
        </button>
        <button type="button" className="primary" onClick={onProcess} disabled={!hasMask}>
          開始去除浮水印
        </button>
      </div>
    </div>
  )
}
