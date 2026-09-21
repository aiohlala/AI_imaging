import { useCallback, useEffect, useRef, useState } from 'react'
import UploadZone from '../UploadZone'
import ImageCropperModal from '../ImageCropperModal'
import {
  removeBackgroundAI,
  buildMaskFromConfidence,
  type BackgroundRemovalResult,
} from '../../lib/mediapipe'

type Status = 'empty' | 'editing' | 'processing'
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

function getBaseName(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '') || 'image'
}

export default function BackgroundRemovalApp() {
  const [status, setStatus] = useState<Status>('empty')
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [fileName, setFileName] = useState('image')
  const [maskCanvas, setMaskCanvas] = useState<HTMLCanvasElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bgType, setBgType] = useState<BgType>('transparent')
  const [customColor, setCustomColor] = useState('#4f8cff')

  // 去背閾值 (10% ~ 90%，預設 50%)
  const [threshold, setThreshold] = useState(50)
  // 快取 MediaPipe 神經網絡推論結果，支援即時滑動更新遮罩
  const [cachedResult, setCachedResult] = useState<BackgroundRemovalResult | null>(null)

  // 微調筆刷控制
  const [brushMode, setBrushMode] = useState<'view' | 'restore' | 'erase'>('view')
  const [brushSize, setBrushSize] = useState(25)
  const [strokes, setStrokes] = useState<Stroke[]>([])

  // 裁切視窗
  const [isCropping, setIsCropping] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const displayCanvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const currentStrokeRef = useRef<Stroke | null>(null)
  const lastPointRef = useRef<Point | null>(null)
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 })

  // 1. 圖片載入：直接進入 editing 模式並顯示原圖，不強制自動去背，避免初次空白
  const handleImageLoaded = useCallback((img: HTMLImageElement, name?: string) => {
    setImage(img)
    setFileName(name || 'image')
    setStatus('editing')
    setMaskCanvas(null)
    setCachedResult(null)
    setError(null)
    setStrokes([])
    setBrushMode('view')
  }, [])

  // 2. 執行 AI 去背（由使用者點擊按鈕觸發）
  const handleRunAI = async () => {
    if (!image) return
    setStatus('processing')
    setError(null)

    try {
      const res = await removeBackgroundAI(image, threshold / 100)
      setCachedResult(res)
      setMaskCanvas(res.maskCanvas)
      setStrokes([])
      setStatus('editing')
    } catch (e) {
      console.error(e)
      setError('AI 去背處理失敗，可能是瀏覽器尚未支援 WebGL 或模型下載受阻。')
      setStatus('editing')
    }
  }

  // 3. 閾值滑桿即時更新遮罩（使用快取的信心度陣列，<5ms 即刻重新生成遮罩）
  const handleThresholdChange = (newVal: number) => {
    setThreshold(newVal)
    if (!cachedResult || !image) return

    const newMask = buildMaskFromConfidence(
      cachedResult.confidenceData,
      cachedResult.maskWidth,
      cachedResult.maskHeight,
      image.naturalWidth,
      image.naturalHeight,
      newVal / 100,
    )

    // 重播使用者手動補上的筆刷
    if (strokes.length > 0) {
      const maskCtx = newMask.getContext('2d')!
      for (const s of strokes) {
        drawStroke(maskCtx, s)
      }
    }
    setMaskCanvas(newMask)
  }

  // 4. 響應式容器縮放尺寸計算
  const updateDisplaySize = useCallback(() => {
    const container = containerRef.current
    if (!container || !image) return
    let w = container.clientWidth
    if (w <= 0) {
      // 容錯機制：若首次掛載尚未排版完畢，使用合理預設值避免 0x0
      w = Math.min(window.innerWidth - 64, image.naturalWidth)
    }
    setDisplaySize({ w, h: Math.round((w * image.naturalHeight) / image.naturalWidth) })
  }, [image])

  useEffect(() => {
    updateDisplaySize()
    const observer = new ResizeObserver(updateDisplaySize)
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [updateDisplaySize])

  // 5. 渲染預覽畫布（若尚未去背則繪製原圖；去背後套用遮罩與底色）
  const renderPreview = useCallback(() => {
    const canvas = displayCanvasRef.current
    if (!canvas || !image || displaySize.w === 0) return

    canvas.width = displaySize.w
    canvas.height = displaySize.h
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // 若尚未去背，直接展示原始清晰圖片
    if (!maskCanvas) {
      ctx.drawImage(image, 0, 0, displaySize.w, displaySize.h)
      return
    }

    // 若已去背且非透明，繪製選定之底色
    if (bgType !== 'transparent') {
      let fillColor = '#ffffff'
      if (bgType === 'blue') fillColor = '#438edb'
      if (bgType === 'red') fillColor = '#d93838'
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

    // 繪製至展示畫布
    ctx.drawImage(tempCanvas, 0, 0, displaySize.w, displaySize.h)
  }, [image, maskCanvas, displaySize, bgType, customColor])

  useEffect(() => {
    renderPreview()
  }, [renderPreview])

  // 6. 手動微調筆刷事件處理
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
    if (brushMode === 'view' || !maskCanvas) return
    const p = toImageCoords(e)
    if (!p) return
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)

    drawingRef.current = true
    const stroke: Stroke = { points: [p], radius: brushSize / 2, mode: brushMode }
    currentStrokeRef.current = stroke
    lastPointRef.current = p
    const ctx = maskCanvas.getContext('2d')!
    drawStroke(ctx, stroke)
    renderPreview()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current || !maskCanvas) return
    const stroke = currentStrokeRef.current
    const last = lastPointRef.current
    if (!stroke || !last) return

    const p = toImageCoords(e)
    if (!p) return

    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
    const ctx = maskCanvas.getContext('2d')!
    let prev = last
    for (const ev of events) {
      const canvas = displayCanvasRef.current!
      const rect = canvas.getBoundingClientRect()
      const pt: Point = {
        x: ((ev.clientX - rect.left) / rect.width) * image!.naturalWidth,
        y: ((ev.clientY - rect.top) / rect.height) * image!.naturalHeight,
      }
      const segment: Stroke = { points: [prev, pt], radius: stroke.radius, mode: stroke.mode }
      drawStroke(ctx, segment)
      stroke.points.push(pt)
      prev = pt
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
    const newStrokes = strokes.slice(0, -1)
    setStrokes(newStrokes)

    // 重新從快取的信心度遮罩或空白產生基礎遮罩並重放筆刷
    if (cachedResult) {
      const baseMask = buildMaskFromConfidence(
        cachedResult.confidenceData,
        cachedResult.maskWidth,
        cachedResult.maskHeight,
        image.naturalWidth,
        image.naturalHeight,
        threshold / 100,
      )
      const maskCtx = baseMask.getContext('2d')!
      for (const s of newStrokes) {
        drawStroke(maskCtx, s)
      }
      setMaskCanvas(baseMask)
    }
  }

  // 7. 裁切處理
  const handleApplyCrop = (croppedImg: HTMLImageElement, croppedMask?: HTMLCanvasElement) => {
    setImage(croppedImg)
    setMaskCanvas(croppedMask ?? null)
    setCachedResult(null) // 尺寸已改變，清除舊的推論快取
    setStrokes([])
    setIsCropping(false)
  }

  // 8. 下載成果圖片（檔名加上 _bgr 說明）
  const handleDownload = () => {
    if (!image) return
    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = image.naturalWidth
    exportCanvas.height = image.naturalHeight
    const ctx = exportCanvas.getContext('2d')!

    if (maskCanvas && bgType !== 'transparent') {
      let fillColor = '#ffffff'
      if (bgType === 'blue') fillColor = '#438edb'
      if (bgType === 'red') fillColor = '#d93838'
      if (bgType === 'custom') fillColor = customColor
      ctx.fillStyle = fillColor
      ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height)
    }

    if (maskCanvas) {
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = image.naturalWidth
      tempCanvas.height = image.naturalHeight
      const tempCtx = tempCanvas.getContext('2d')!
      tempCtx.drawImage(image, 0, 0)
      tempCtx.globalCompositeOperation = 'destination-in'
      tempCtx.drawImage(maskCanvas, 0, 0)
      ctx.drawImage(tempCanvas, 0, 0)
    } else {
      ctx.drawImage(image, 0, 0)
    }

    exportCanvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const base = getBaseName(fileName)
      a.download = `${base}_bgr.png`
      a.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  const handleResetImage = () => {
    setImage(null)
    setMaskCanvas(null)
    setCachedResult(null)
    setStatus('empty')
    setError(null)
    setStrokes([])
  }

  const handleClearMask = () => {
    setMaskCanvas(null)
    setCachedResult(null)
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
            支援透明背景 PNG 下載、證件照純色替換（白底/藍底/紅底），並具備手動筆刷修邊與自由裁切！
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

      {status === 'editing' && image && (
        <div className="bg-result-workspace">
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}

          {/* 工具控制條 */}
          <div className="toolbar bg-toolbar">
            {/* AI 執行與裁切 */}
            <div className="tool-selector">
              <button
                type="button"
                className="tool-btn ai-magic-btn"
                onClick={handleRunAI}
                title="執行 Google MediaPipe 本機智慧去背"
              >
                ✨ AI 一鍵去背
              </button>
              <button
                type="button"
                className="tool-btn"
                onClick={() => setIsCropping(true)}
                title="裁切目前圖片尺寸"
              >
                ✂️ 裁切圖片
              </button>
              {maskCanvas && (
                <button
                  type="button"
                  className="tool-btn"
                  onClick={handleClearMask}
                  title="清空去背遮罩，檢視原圖"
                >
                  ↩️ 還原原圖
                </button>
              )}
            </div>

            {/* 背景底色選擇（有遮罩時可選） */}
            {maskCanvas && (
              <div className="bg-selector">
                <span className="control-label">底色：</span>
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
            )}

            {/* 手動微調工具切換 */}
            {maskCanvas && (
              <div className="manual-tools">
                <span className="control-label">修邊：</span>
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
            )}
          </div>

          {/* 滑桿列：靈敏度閾值 ＆ 微調筆刷 */}
          <div className="sliders-bar bg-sliders">
            <label className="brush-control" title="調整 AI 去背判定嚴格度">
              去背靈敏度 (閾值)
              <input
                type="range"
                min={10}
                max={90}
                value={threshold}
                onChange={(e) => handleThresholdChange(Number(e.target.value))}
              />
              <span className="brush-value">{threshold}%</span>
            </label>

            {maskCanvas && brushMode !== 'view' && (
              <label className="brush-control">
                微調筆刷大小
                <input
                  type="range"
                  min={5}
                  max={150}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                />
                <span className="brush-value">{brushSize}px</span>
              </label>
            )}
            {!maskCanvas && (
              <span className="hint-text">點擊上方「✨ AI 一鍵去背」開始自動分離主體與背景</span>
            )}
          </div>

          {/* 畫布檢視區（棋盤格背景） */}
          <div ref={containerRef} className="canvas-container">
            <div
              className={`checkerboard-bg canvas-stack${brushMode !== 'view' && maskCanvas ? ' interactive' : ''}`}
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
            <button type="button" className="secondary" onClick={handleResetImage}>
              換一張圖片
            </button>
            <button type="button" className="primary bg-primary-btn" onClick={handleDownload}>
              下載成果圖片 ({getBaseName(fileName)}_bgr.png)
            </button>
          </div>

          {/* 裁切視窗 */}
          {isCropping && (
            <ImageCropperModal
              image={image}
              maskCanvas={maskCanvas}
              onApply={handleApplyCrop}
              onCancel={() => setIsCropping(false)}
            />
          )}
        </div>
      )}
    </div>
  )
}
