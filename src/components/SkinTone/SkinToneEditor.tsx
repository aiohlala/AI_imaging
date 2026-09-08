import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type HarmonizeOptions,
  type LabStats,
  sampleSkinToneAt,
} from '../../lib/colorTransfer'

const MIN_BRUSH = 5
const MAX_BRUSH = 150
const MAX_UNDO = 30

interface Point {
  x: number
  y: number
}

interface Stroke {
  points: Point[]
  radius: number
  erase: boolean
}

export type DirectionMode = 'body-to-face' | 'face-to-body'

interface SkinToneEditorProps {
  image: HTMLImageElement
  maskCanvas: HTMLCanvasElement
  onProcess: (config: { refStats: LabStats; options: HarmonizeOptions }) => void
  onBack: () => void
}

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
    ctx.beginPath()
    ctx.arc(prev.x, prev.y, stroke.radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

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

export default function SkinToneEditor({
  image,
  maskCanvas,
  onProcess,
  onBack,
}: SkinToneEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const baseCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const strokesRef = useRef<Stroke[]>([])
  const drawingRef = useRef(false)
  const currentStrokeRef = useRef<Stroke | null>(null)
  const lastPointRef = useRef<Point | null>(null)

  // 方向模式
  const [direction, setDirection] = useState<DirectionMode>('body-to-face')
  // 當前操作工具：'brush' 塗抹遮罩 | 'eyedropper' 取樣參考膚色
  const [activeTool, setActiveTool] = useState<'brush' | 'eyedropper'>('eyedropper')
  const [eraser, setEraser] = useState(false)
  const [brushSize, setBrushSize] = useState(40)
  const [strokeCount, setStrokeCount] = useState(0)
  const [hasMask, setHasMask] = useState(() => maskHasContent(maskCanvas))
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 })

  // 膚色調和參數
  const [strength, setStrength] = useState(85)
  const [preserveLighting, setPreserveLighting] = useState(85)
  const [featherRadius, setFeatherRadius] = useState(18)

  // 採樣的參考膚色
  const [sampleData, setSampleData] = useState<{
    stats: LabStats
    previewRgb: [number, number, number]
    hex: string
  } | null>(null)

  const imgW = image.naturalWidth
  const imgH = image.naturalHeight

  // 圖片載入後自動在中心附近採樣一個初始點（避免未選取直接點擊卡住，使用者亦可重新吸取）
  useEffect(() => {
    if (!sampleData && baseCanvasRef.current) {
      const offCanvas = document.createElement('canvas')
      offCanvas.width = imgW
      offCanvas.height = imgH
      const offCtx = offCanvas.getContext('2d')!
      offCtx.drawImage(image, 0, 0)
      const initSample = sampleSkinToneAt(offCanvas, Math.round(imgW * 0.5), Math.round(imgH * 0.5), 12)
      setSampleData(initSample)
    }
  }, [image, imgW, imgH, sampleData])

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

  // 重繪底圖
  useEffect(() => {
    const base = baseCanvasRef.current
    if (!base || displaySize.w === 0) return
    base.width = displaySize.w
    base.height = displaySize.h
    const ctx = base.getContext('2d')!
    ctx.drawImage(image, 0, 0, displaySize.w, displaySize.h)
  }, [image, displaySize])

  // 重繪上層遮罩（以青色半透明呈現目標校正區域）
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
    ctx.fillStyle = 'rgba(14, 165, 233, 0.45)'
    ctx.fillRect(0, 0, overlay.width, overlay.height)
    ctx.globalCompositeOperation = 'source-over'
  }, [maskCanvas, displaySize])

  useEffect(() => {
    redrawOverlay()
  }, [redrawOverlay])

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

    if (activeTool === 'eyedropper') {
      // 執行吸管採樣
      const offCanvas = document.createElement('canvas')
      offCanvas.width = imgW
      offCanvas.height = imgH
      const offCtx = offCanvas.getContext('2d')!
      offCtx.drawImage(image, 0, 0)
      const sampled = sampleSkinToneAt(offCanvas, p.x, p.y, 10)
      setSampleData(sampled)
      // 採樣完成後自動切換至塗抹筆刷，流程極為順暢
      setActiveTool('brush')
      return
    }

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
    if (activeTool === 'eyedropper') return
    if (!drawingRef.current) return
    const stroke = currentStrokeRef.current
    const last = lastPointRef.current
    if (!stroke || !last) return

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
      if (strokesRef.current.length > MAX_UNDO) strokesRef.current.shift()
      setStrokeCount(strokesRef.current.length)
    }
  }

  const undo = () => {
    const strokes = strokesRef.current
    if (strokes.length === 0) return
    strokes.pop()
    setStrokeCount(strokes.length)
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

  const handleStart = () => {
    if (!sampleData || !hasMask) return
    onProcess({
      refStats: sampleData.stats,
      options: {
        strength: strength / 100,
        preserveLighting: preserveLighting / 100,
        featherRadius,
      },
    })
  }

  return (
    <div className="mask-editor skin-tone-editor">
      {/* 步驟提示條 */}
      <div className="mode-selection-bar">
        <div className="direction-tabs">
          <button
            type="button"
            className={`direction-btn${direction === 'body-to-face' ? ' active' : ''}`}
            onClick={() => setDirection('body-to-face')}
          >
            👗 抓取身體膚色 ➔ 同步臉部
          </button>
          <button
            type="button"
            className={`direction-btn${direction === 'face-to-body' ? ' active' : ''}`}
            onClick={() => setDirection('face-to-body')}
          >
            💄 抓取臉部膚色 ➔ 同步身體
          </button>
        </div>
        <div className="direction-hint">
          {direction === 'body-to-face'
            ? '步驟：1. 使用吸管點選「身體/胸頸」膚色 ➜ 2. 塗抹筆刷標記「臉部」區域 ➜ 3. 開始調和'
            : '步驟：1. 使用吸管點選「臉部」膚色 ➜ 2. 塗抹筆刷標記「身體/頸部/手臂」區域 ➜ 3. 開始調和'}
        </div>
      </div>

      {/* 主要工具列 */}
      <div className="toolbar skin-toolbar">
        <div className="tool-selector">
          <button
            type="button"
            className={`tool-btn${activeTool === 'eyedropper' ? ' active' : ''}`}
            onClick={() => {
              setActiveTool('eyedropper')
              setEraser(false)
            }}
            title="點擊圖片上的參考皮膚取樣色彩"
          >
            💧 點擊取樣膚色
          </button>
          <button
            type="button"
            className={`tool-btn${activeTool === 'brush' && !eraser ? ' active' : ''}`}
            onClick={() => {
              setActiveTool('brush')
              setEraser(false)
            }}
            title="塗抹要調整膚色的目標區域"
          >
            🖌️ 塗抹目標區
          </button>
          <button
            type="button"
            className={`tool-btn${eraser ? ' active' : ''}`}
            onClick={() => {
              setActiveTool('brush')
              setEraser(true)
            }}
            title="擦除誤塗的區域"
          >
            🧹 橡皮擦
          </button>
        </div>

        {/* 參考色預覽標籤 */}
        <div className="sample-indicator">
          <span className="sample-label">參考膚色：</span>
          {sampleData ? (
            <div className="sample-chip">
              <span
                className="color-dot"
                style={{
                  backgroundColor: sampleData.hex,
                }}
              />
              <span className="sample-hex">{sampleData.hex.toUpperCase()}</span>
            </div>
          ) : (
            <span className="sample-prompt">請點擊吸管取樣</span>
          )}
        </div>

        <div className="toolbar-buttons">
          <button type="button" onClick={undo} disabled={strokeCount === 0}>
            復原
          </button>
          <button type="button" onClick={clearAll} disabled={!hasMask}>
            清除塗抹
          </button>
        </div>
      </div>

      {/* 參數微調列 */}
      <div className="sliders-bar">
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

        <label className="brush-control">
          邊緣羽化
          <input
            type="range"
            min={0}
            max={40}
            value={featherRadius}
            onChange={(e) => setFeatherRadius(Number(e.target.value))}
          />
          <span className="brush-value">{featherRadius}px</span>
        </label>

        <label className="brush-control">
          調和強度
          <input
            type="range"
            min={10}
            max={100}
            value={strength}
            onChange={(e) => setStrength(Number(e.target.value))}
          />
          <span className="brush-value">{strength}%</span>
        </label>

        <label className="brush-control" title="數值越高越保留原本照片的面部/肌肉明暗立體感">
          保留原始立體光影
          <input
            type="range"
            min={0}
            max={100}
            value={preserveLighting}
            onChange={(e) => setPreserveLighting(Number(e.target.value))}
          />
          <span className="brush-value">{preserveLighting}%</span>
        </label>
      </div>

      {/* 畫布工作區 */}
      <div ref={containerRef} className="canvas-container">
        <div
          className="canvas-stack"
          style={{ width: displaySize.w || undefined, height: displaySize.h || undefined }}
        >
          <canvas ref={baseCanvasRef} className="base-canvas" />
          <canvas
            ref={overlayCanvasRef}
            className={`overlay-canvas overlay-skin${
              activeTool === 'eyedropper' ? ' eyedropper' : eraser ? ' erasing' : ''
            }`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finishStroke}
            onPointerCancel={finishStroke}
          />
        </div>
      </div>

      {/* 底部操作列 */}
      <div className="action-bar">
        <button type="button" className="secondary" onClick={onBack}>
          換一張圖片
        </button>
        <button
          type="button"
          className="primary skin-primary-btn"
          onClick={handleStart}
          disabled={!sampleData || !hasMask}
        >
          開始調和膚色
        </button>
      </div>
    </div>
  )
}
