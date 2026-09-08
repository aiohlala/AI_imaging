import { useCallback, useEffect, useRef, useState } from 'react'
import UploadZone from '../UploadZone'
import { removeBackgroundAI } from '../../lib/mediapipe'

type Status = 'empty' | 'processing' | 'done'
type BgType = 'transparent' | 'white' | 'blue' | 'red' | 'custom'

interface Point {
  x: number
  y: number
}

interface Stroke {
  points: Point[]
  radius: number
  mode: 'restore' | 'erase' // restore = 畫回主體 (白色), erase = 擦除背景 (透明)
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  if (stroke.points.length === 0) return
  ctx.save()
  ctx.globalCompositeOperation = stroke.mode === 'restore' ? 'source-over' : 'destination-out'
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

export default function BackgroundRemovalApp() {
  const [status, setStatus] = useState<Status>('empty')
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [maskCanvas, setMaskCanvas] = useState<HTMLCanvasElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bgType, setBgType] = useState<BgType>('transparent')
  const [customColor, setCustomColor] = useState('#4f8cff')

  // 微調筆刷控制
  const [brushMode, setBrushMode] = useState<'view' | 'restore' | 'erase'>('view')
  const [brushSize, setBrushSize] = useState(25)
  const [strokes, setStrokes] = useState<Stroke[]>([])

  const containerRef = useRef<HTMLDivElement>(null)
  const displayCanvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const currentStrokeRef = useRef<Stroke | null>(null)
  const lastPointRef = useRef<Point | null>(null)
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 })

  // 1. 處理上傳並自動觸發 AI 去背
  const handleImageLoaded = useCallback(async (img: HTMLImageElement) => {
    setImage(img)
    setStatus('processing')
    setError(null)
    setStrokes([])
    setBrushMode('view')

    try {
      const { maskCanvas: mask } = await removeBackgroundAI(img)
      setMaskCanvas(mask)
      setStatus('done')
    } catch (e) {
      console.error(e)
      setError('AI 去背處理失敗，可能是瀏覽器尚未支援 WebGL 或模型下載受阻。')
      setStatus('empty')
    }
  }, [])

  // 2. 響應式容器縮放
  const updateDisplaySize = useCallback(() => {
    const container = containerRef.current
    if (!container || !image) return
    const w = container.clientWidth
    if (w <= 0) return
    setDisplaySize({ w, h: Math.round((w * image.naturalHeight) / image.naturalWidth) })
  }, [image])

  useEffect(() => {
    updateDisplaySize()
    const observer = new ResizeObserver(updateDisplaySize)
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [updateDisplaySize])

  // 3. 渲染預覽畫布（底色 + 遮罩裁切）
  const renderPreview = useCallback(() => {
    const canvas = displayCanvasRef.current
    if (!canvas || !image || !maskCanvas || displaySize.w === 0) return

    canvas.width = displaySize.w
    canvas.height = displaySize.h
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // 若非透明，繪製自訂底色
    if (bgType !== 'transparent') {
      let fillColor = '#ffffff'
      if (bgType === 'blue') fillColor = '#438edb' // 常用證件藍
      if (bgType === 'red') fillColor = '#d93838' // 常用證件紅
      if (bgType === 'custom') fillColor = customColor
      ctx.fillStyle = fillColor
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }

    // 建立臨時畫布結合原圖與遮罩
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = image.naturalWidth
    tempCanvas.height = image.naturalHeight
    const tempCtx = tempCanvas.getContext('2d')!
    tempCtx.drawImage(image, 0, 0)
    tempCtx.globalCompositeOperation = 'destination-in'
    tempCtx.drawImage(maskCanvas, 0, 0)

    // 將裁切後的主體繪製至展示畫布
    ctx.drawImage(tempCanvas, 0, 0, displaySize.w, displaySize.h)
  }, [image, maskCanvas, displaySize, bgType, customColor])

  useEffect(() => {
    renderPreview()
  }, [renderPreview])

  // 4. 手動微調筆刷事件處理
  const toImageCoords = (e: React.PointerEvent): Point | null => {
    const canvas = displayCanvasRef.current
    if (!canvas || !image) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0) return null
    return {
      x: ((e.clientX - rect.left) / rect.width) * image.naturalWidth,
      y: ((e.clientY - rect.top) / rect.height) * image.naturalHeight,
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (brushMode === 'view') return
    const p = toImageCoords(e)
    if (!p || !maskCanvas) return
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)

    drawingRef.current = true
    const stroke: Stroke = { points: [p], radius: brushSize / 2, mode: brushMode }
    currentStrokeRef.current = stroke
    lastPointRef.current = p

    const maskCtx = maskCanvas.getContext('2d')!
    drawStroke(maskCtx, stroke)
    renderPreview()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current || brushMode === 'view' || !maskCanvas || !image) return
    const stroke = currentStrokeRef.current
    const last = lastPointRef.current
    if (!stroke || !last) return

    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
    const maskCtx = maskCanvas.getContext('2d')!
    const canvas = displayCanvasRef.current!
    let prev = last

    for (const ev of events) {
      const rect = canvas.getBoundingClientRect()
      const p: Point = {
        x: ((ev.clientX - rect.left) / rect.width) * image.naturalWidth,
        y: ((ev.clientY - rect.top) / rect.height) * image.naturalHeight,
      }
      const segment: Stroke = { points: [prev, p], radius: stroke.radius, mode: stroke.mode }
      drawStroke(maskCtx, segment)
      stroke.points.push(p)
      prev = p
    }

    lastPointRef.current = prev
    renderPreview()
  }

  const finishStroke = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    const stroke = currentStrokeRef.current
    currentStrokeRef.current = null
    lastPointRef.current = null

    if (stroke && stroke.points.length > 0) {
      setStrokes((prev) => [...prev, stroke])
    }
  }

  const handleUndo = () => {
    if (strokes.length === 0 || !image) return
    // 重新觸發去背復原，或者重放
    const newStrokes = strokes.slice(0, -1)
    setStrokes(newStrokes)
    // 重新跑一次 AI 去背遮罩並重放
    void removeBackgroundAI(image).then(({ maskCanvas: newMask }) => {
      const maskCtx = newMask.getContext('2d')!
      for (const s of newStrokes) {
        drawStroke(maskCtx, s)
      }
      setMaskCanvas(newMask)
    })
  }

  // 5. 下載高品質成果
  const handleDownload = () => {
    if (!image || !maskCanvas) return
    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = image.naturalWidth
    exportCanvas.height = image.naturalHeight
    const ctx = exportCanvas.getContext('2d')!

    if (bgType !== 'transparent') {
      let fillColor = '#ffffff'
      if (bgType === 'blue') fillColor = '#438edb'
      if (bgType === 'red') fillColor = '#d93838'
      if (bgType === 'custom') fillColor = customColor
      ctx.fillStyle = fillColor
      ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height)
    }

    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = image.naturalWidth
    tempCanvas.height = image.naturalHeight
    const tempCtx = tempCanvas.getContext('2d')!
    tempCtx.drawImage(image, 0, 0)
    tempCtx.globalCompositeOperation = 'destination-in'
    tempCtx.drawImage(maskCanvas, 0, 0)

    ctx.drawImage(tempCanvas, 0, 0)

    exportCanvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = bgType === 'transparent' ? 'background-removed.png' : 'id-photo.png'
      a.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  const handleReset = () => {
    setImage(null)
    setMaskCanvas(null)
    setStatus('empty')
    setError(null)
    setStrokes([])
  }

  return (
    <div className="bg-removal-app">
      {status === 'empty' && (
        <div className="bg-intro-wrapper">
          <div className="feature-badge">✂️ 智慧人像去背</div>
          <p className="intro-text">
            使用 Google MediaPipe WebAssembly 模型，毫秒級自動精準去背。
            <br />
            支援透明背景 PNG 下載、證件照純色替換（白底/藍底/紅底），並具備手動筆刷修邊！
          </p>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <UploadZone onImageLoaded={handleImageLoaded} />
        </div>
      )}

      {status === 'processing' && (
        <div className="processing">
          <div className="spinner bg-spinner" aria-hidden="true" />
          <p>AI 正在分析影像並去除背景…</p>
          <p className="hint-text">Google MediaPipe 本機神經網路處理中，請稍候</p>
        </div>
      )}

      {status === 'done' && image && maskCanvas && (
        <div className="bg-result-workspace">
          {/* 工具控制條 */}
          <div className="toolbar bg-toolbar">
            {/* 背景底色選擇 */}
            <div className="bg-selector">
              <span className="control-label">更換底色：</span>
              <button
                type="button"
                className={`bg-chip-btn transparent${bgType === 'transparent' ? ' active' : ''}`}
                onClick={() => setBgType('transparent')}
                title="透明背景 (PNG)"
              >
                🏁 透明
              </button>
              <button
                type="button"
                className={`bg-chip-btn white${bgType === 'white' ? ' active' : ''}`}
                onClick={() => setBgType('white')}
                title="純白底 (標準證件照)"
              >
                ⚪ 白底
              </button>
              <button
                type="button"
                className={`bg-chip-btn blue${bgType === 'blue' ? ' active' : ''}`}
                onClick={() => setBgType('blue')}
                title="證件藍"
              >
                🔵 藍底
              </button>
              <button
                type="button"
                className={`bg-chip-btn red${bgType === 'red' ? ' active' : ''}`}
                onClick={() => setBgType('red')}
                title="證件紅"
              >
                🔴 紅底
              </button>
              <label className={`bg-chip-label${bgType === 'custom' ? ' active' : ''}`} title="自訂顏色">
                🎨 自訂
                <input
                  type="color"
                  value={customColor}
                  onChange={(e) => {
                    setCustomColor(e.target.value)
                    setBgType('custom')
                  }}
                />
              </label>
            </div>

            {/* 手動微調工具切換 */}
            <div className="manual-tools">
              <span className="control-label">邊緣微調：</span>
              <button
                type="button"
                className={`tool-btn${brushMode === 'view' ? ' active' : ''}`}
                onClick={() => setBrushMode('view')}
              >
                👁️ 檢視
              </button>
              <button
                type="button"
                className={`tool-btn${brushMode === 'restore' ? ' active' : ''}`}
                onClick={() => setBrushMode('restore')}
                title="塗抹還原被誤切的主體"
              >
                🖌️ 還原主體
              </button>
              <button
                type="button"
                className={`tool-btn${brushMode === 'erase' ? ' active' : ''}`}
                onClick={() => setBrushMode('erase')}
                title="擦除多餘的背景"
              >
                🧹 擦除背景
              </button>
              <button type="button" onClick={handleUndo} disabled={strokes.length === 0}>
                復原
              </button>
            </div>
          </div>

          {/* 筆刷大小滑桿（僅在微調模式顯示） */}
          {brushMode !== 'view' && (
            <div className="sliders-bar bg-sliders">
              <label className="brush-control">
                微調筆刷大小
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                />
                <span className="brush-value">{brushSize}px</span>
              </label>
              <span className="hint-text">在畫布上滑動塗抹即可修補髮絲或邊界</span>
            </div>
          )}

          {/* 畫布檢視區（棋盤格背景） */}
          <div ref={containerRef} className="canvas-container">
            <div
              className={`checkerboard-bg canvas-stack${brushMode !== 'view' ? ' interactive' : ''}`}
              style={{ width: displaySize.w || undefined, height: displaySize.h || undefined }}
            >
              <canvas
                ref={displayCanvasRef}
                className="bg-display-canvas"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={finishStroke}
                onPointerCancel={finishStroke}
              />
            </div>
          </div>

          {/* 底部操作列 */}
          <div className="action-bar">
            <button type="button" className="secondary" onClick={handleReset}>
              換一張圖片
            </button>
            <button type="button" className="primary bg-primary-btn" onClick={handleDownload}>
              下載成果圖片 ({bgType === 'transparent' ? '透明 PNG' : '純色底 PNG'})
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
