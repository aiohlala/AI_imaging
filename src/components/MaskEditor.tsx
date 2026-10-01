import { useCallback, useEffect, useRef, useState } from 'react'
import { autoScanWatermarks, smartClickWatermark } from '../lib/watermarkDetector'
import ImageCropperModal from './ImageCropperModal'
import { CloneStampEngine, type Point } from '../lib/cloneStamp'

const MIN_BRUSH = 5
const MAX_BRUSH = 300
/** 復原上限步數 */
const MAX_UNDO = 30

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
  onProcess: (workingCanvas?: HTMLCanvasElement) => void
  onBack: () => void
  onCrop: (newImage: HTMLImageElement, newMaskCanvas?: HTMLCanvasElement) => void
  onCompleteWithoutInpaint?: (finalCanvas: HTMLCanvasElement) => void
}

interface HistoryStep {
  type: 'mask' | 'clone'
  data: ImageData
}

/** 在 ctx 上重放一筆遮罩（圓形筆刷 + 線段間補圓避免斷線） */
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

export default function MaskEditor({
  image,
  maskCanvas,
  onProcess,
  onBack,
  onCrop,
  onCompleteWithoutInpaint,
}: MaskEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const baseCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)

  // 模式選擇：'brush' (塗抹標記) | 'magic' (AI點選) | 'rect' (快速框選) | 'clone' (克隆圖章)
  const [drawMode, setDrawMode] = useState<'brush' | 'magic' | 'rect' | 'clone'>('brush')

  // 一般筆刷與遮罩狀態
  const [brushSize, setBrushSize] = useState(30)
  const [eraser, setEraser] = useState(false)
  const [magicTolerance, setMagicTolerance] = useState(25)
  const [hasMask, setHasMask] = useState(() => maskHasContent(maskCanvas))
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 })
  const [isScanning, setIsScanning] = useState(false)
  const [isCropping, setIsCropping] = useState(false)

  // 克隆圖章 (Clone Stamp) 專屬狀態
  const [cloneSubMode, setCloneSubMode] = useState<'sample' | 'stamp'>('sample')
  const [sourcePoint, setSourcePoint] = useState<Point | null>(null)
  const [cloneSize, setCloneSize] = useState(35)
  const [cloneFeather, setCloneFeather] = useState(50) // 0% ~ 100%
  const [cloneOpacity, setCloneOpacity] = useState(100) // 10% ~ 100%
  const [cloneAligned, setCloneAligned] = useState(true)
  const [hasImageEdits, setHasImageEdits] = useState(false)
  const [isAltPressed, setIsAltPressed] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // 統一歷史步驟紀錄（支援遮罩與克隆圖章混合 Undo）
  const historyRef = useRef<HistoryStep[]>([])
  const [historyCount, setHistoryCount] = useState(0)

  // 底圖工作畫布與引擎
  const workingCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const sourceSnapshotRef = useRef<HTMLCanvasElement | null>(null)
  const cloneEngineRef = useRef<CloneStampEngine>(new CloneStampEngine())

  // 繪製運行時暫存
  const strokesRef = useRef<Stroke[]>([])
  const drawingRef = useRef(false)
  const isDraggingSourceRef = useRef(false)
  const isStampingRef = useRef(false)
  const cloneOffsetRef = useRef<Point>({ x: 0, y: 0 })
  const currentMovingSourceRef = useRef<Point | null>(null)
  const hoverPointRef = useRef<Point | null>(null)
  const currentStrokeRef = useRef<Stroke | null>(null)
  const lastPointRef = useRef<Point | null>(null)
  const startPointRef = useRef<Point | null>(null)
  const currentDragPointRef = useRef<Point | null>(null)

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

  /** 重新繪製底層畫布（以 workingCanvas 作為圖像來源） */
  const redrawBase = useCallback(() => {
    const base = baseCanvasRef.current
    const working = workingCanvasRef.current
    if (!base || !working || displaySize.w === 0) return
    if (base.width !== displaySize.w || base.height !== displaySize.h) {
      base.width = displaySize.w
      base.height = displaySize.h
    }
    const ctx = base.getContext('2d')!
    ctx.drawImage(working, 0, 0, displaySize.w, displaySize.h)
  }, [displaySize])

  /** 初始化 workingCanvas */
  useEffect(() => {
    const working = document.createElement('canvas')
    working.width = imgW
    working.height = imgH
    const ctx = working.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    workingCanvasRef.current = working
    setHasImageEdits(false)
    setSourcePoint(null)
    historyRef.current = []
    setHistoryCount(0)
    redrawBase()
  }, [image, imgW, imgH, redrawBase])

  useEffect(() => {
    redrawBase()
  }, [redrawBase])

  /** 重繪上層 overlay（mask 遮罩、框選預覽、克隆圖章準星與筆刷預覽） */
  const redrawOverlay = useCallback(() => {
    const overlay = overlayCanvasRef.current
    if (!overlay || displaySize.w === 0) return
    if (overlay.width !== displaySize.w || overlay.height !== displaySize.h) {
      overlay.width = displaySize.w
      overlay.height = displaySize.h
    }
    const ctx = overlay.getContext('2d')!
    ctx.clearRect(0, 0, overlay.width, overlay.height)

    // 1. 若有遮罩內容，顯示半透明紅色遮罩
    ctx.drawImage(maskCanvas, 0, 0, overlay.width, overlay.height)
    ctx.globalCompositeOperation = 'source-in'
    ctx.fillStyle = 'rgba(255, 60, 60, 0.5)'
    ctx.fillRect(0, 0, overlay.width, overlay.height)
    ctx.globalCompositeOperation = 'source-over'

    const scaleX = overlay.width / imgW
    const scaleY = overlay.height / imgH

    // 2. 矩形框選預覽
    if (drawMode === 'rect' && startPointRef.current && currentDragPointRef.current) {
      const sx = startPointRef.current.x * scaleX
      const sy = startPointRef.current.y * scaleY
      const ex = currentDragPointRef.current.x * scaleX
      const ey = currentDragPointRef.current.y * scaleY
      ctx.save()
      ctx.strokeStyle = '#4f8cff'
      ctx.lineWidth = 2
      ctx.setLineDash([4, 4])
      ctx.fillStyle = 'rgba(79, 140, 255, 0.25)'
      const rx = Math.min(sx, ex)
      const ry = Math.min(sy, ey)
      const rw = Math.abs(ex - sx)
      const rh = Math.abs(ey - sy)
      ctx.fillRect(rx, ry, rw, rh)
      ctx.strokeRect(rx, ry, rw, rh)
      ctx.restore()
    }

    // 3. 克隆圖章視覺元素
    if (drawMode === 'clone') {
      const engine = cloneEngineRef.current

      // (a) 取樣點準星錨點
      const activeSource = currentMovingSourceRef.current || sourcePoint
      if (activeSource) {
        engine.drawSourceMarker(
          ctx,
          activeSource,
          scaleX,
          scaleY,
          isDraggingSourceRef.current,
        )
      }

      // (b) 塗抹進行中的動態連結虛線
      if (isStampingRef.current && activeSource && lastPointRef.current) {
        engine.drawActiveStampLink(ctx, activeSource, lastPointRef.current, scaleX, scaleY)
      }

      // (c) 目標筆刷邊界與柔邊環預覽
      const targetPoint = hoverPointRef.current || (isStampingRef.current ? lastPointRef.current : null)
      if (
        targetPoint &&
        !isDraggingSourceRef.current &&
        cloneSubMode === 'stamp' &&
        !isAltPressed
      ) {
        engine.drawBrushPreview(
          ctx,
          targetPoint,
          scaleX,
          scaleY,
          cloneSize / 2,
          cloneFeather / 100,
        )
      }
    }
  }, [
    maskCanvas,
    displaySize,
    imgW,
    imgH,
    drawMode,
    cloneSubMode,
    sourcePoint,
    cloneSize,
    cloneFeather,
    isAltPressed,
  ])

  useEffect(() => {
    redrawOverlay()
  }, [redrawOverlay])

  /** 監聽電腦鍵盤 Alt / Option 鍵快速切換取樣 */
  useEffect(() => {
    if (drawMode !== 'clone') return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        setIsAltPressed(true)
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        setIsAltPressed(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [drawMode])

  /** 儲存單一步驟歷史紀錄 */
  const recordHistory = useCallback(
    (type: 'mask' | 'clone') => {
      if (type === 'mask') {
        const ctx = maskCanvas.getContext('2d')!
        const data = ctx.getImageData(0, 0, imgW, imgH)
        historyRef.current.push({ type: 'mask', data })
      } else {
        const working = workingCanvasRef.current
        if (working) {
          const ctx = working.getContext('2d')!
          const data = ctx.getImageData(0, 0, imgW, imgH)
          historyRef.current.push({ type: 'clone', data })
        }
      }
      if (historyRef.current.length > MAX_UNDO) {
        historyRef.current.shift()
      }
      setHistoryCount(historyRef.current.length)
    },
    [imgW, imgH, maskCanvas],
  )

  /** 將 pointer 事件的 client 座標換算成原圖解析度座標 */
  const toImageCoords = (e: React.PointerEvent): Point | null => {
    const overlay = overlayCanvasRef.current
    if (!overlay) return null
    const rect = overlay.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    return {
      x: ((e.clientX - rect.left) / rect.width) * imgW,
      y: ((e.clientY - rect.top) / rect.height) * imgH,
    }
  }

  const handleAutoScan = async () => {
    setIsScanning(true)
    try {
      recordHistory('mask')
      const count = await autoScanWatermarks(image, maskCanvas)
      if (count > 0) {
        setHasMask(true)
        redrawOverlay()
      } else {
        alert('未偵測到明顯的文字浮水印，請點選「🪄 AI 點選圈選」或「🔲 快速框選」直接標記！')
      }
    } catch (e) {
      console.error(e)
      alert('AI 掃描時發生錯誤，請改用手動工具。')
    } finally {
      setIsScanning(false)
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const p = toImageCoords(e)
    if (!p) return
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)

    if (drawMode === 'magic') {
      recordHistory('mask')
      void smartClickWatermark(image, maskCanvas, p.x, p.y, magicTolerance).then(() => {
        redrawOverlay()
        setHasMask(true)
      })
      return
    }

    if (drawMode === 'clone') {
      const isAlt = e.altKey || isAltPressed
      const isSampleAction = cloneSubMode === 'sample' || isAlt

      // 手機觸控友善：檢查是否按在現有取樣點附近 (觸控半徑 30px)，支援直接拖曳錨點
      const overlay = overlayCanvasRef.current
      const rect = overlay?.getBoundingClientRect()
      const scaleX = (rect?.width || 1) / imgW
      const scaleY = (rect?.height || 1) / imgH

      const isTouchingNearSource =
        sourcePoint &&
        !isSampleAction &&
        (() => {
          if (!rect) return false
          const sx = sourcePoint.x * scaleX
          const sy = sourcePoint.y * scaleY
          const clickX = e.clientX - rect.left
          const clickY = e.clientY - rect.top
          return Math.hypot(clickX - sx, clickY - sy) <= 30
        })()

      if (isTouchingNearSource) {
        // 直接拖曳取樣點，無需切換模式
        isDraggingSourceRef.current = true
        drawingRef.current = true
        setSourcePoint(p)
        redrawOverlay()
        return
      }

      if (isSampleAction || !sourcePoint) {
        // 設定取樣點
        setSourcePoint(p)
        setCloneSubMode('stamp')
        setToastMessage('✅ 已選定取樣點！請在浮水印上滑動塗抹覆蓋消除')
        redrawOverlay()
        return
      }

      // 進入塗抹仿製 (Stamp) 模式
      isStampingRef.current = true
      drawingRef.current = true
      lastPointRef.current = p
      hoverPointRef.current = p

      // 保存歷史步驟
      recordHistory('clone')

      // 拍下當前 workingCanvas 快照作為純淨來源，杜絕自取樣拉花
      const working = workingCanvasRef.current
      if (working) {
        if (!sourceSnapshotRef.current) {
          sourceSnapshotRef.current = document.createElement('canvas')
        }
        const snap = sourceSnapshotRef.current
        snap.width = imgW
        snap.height = imgH
        const sCtx = snap.getContext('2d')!
        sCtx.drawImage(working, 0, 0)
      }

      // 計算 offset: source = target + offset
      const offset: Point = { x: sourcePoint.x - p.x, y: sourcePoint.y - p.y }
      cloneOffsetRef.current = offset
      currentMovingSourceRef.current = { x: p.x + offset.x, y: p.y + offset.y }

      // 蓋印第一筆
      if (sourceSnapshotRef.current && working) {
        cloneEngineRef.current.stampDab(
          sourceSnapshotRef.current,
          working,
          currentMovingSourceRef.current,
          p,
          cloneSize / 2,
          cloneFeather / 100,
          cloneOpacity / 100,
        )
        setHasImageEdits(true)
        redrawBase()
      }
      redrawOverlay()
      return
    }

    // 常規筆刷或矩形模式
    drawingRef.current = true

    if (drawMode === 'rect') {
      startPointRef.current = p
      currentDragPointRef.current = p
      return
    }

    recordHistory('mask')
    const stroke: Stroke = { points: [p], radius: brushSize / 2, erase: eraser }
    currentStrokeRef.current = stroke
    lastPointRef.current = p
    const ctx = maskCanvas.getContext('2d')!
    drawStroke(ctx, stroke)
    redrawOverlay()
    setHasMask(true)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toImageCoords(e)
    if (!p) return

    hoverPointRef.current = p

    if (drawMode === 'clone') {
      if (isDraggingSourceRef.current) {
        setSourcePoint(p)
        redrawOverlay()
        return
      }

      if (isStampingRef.current && lastPointRef.current) {
        const offset = cloneOffsetRef.current
        const working = workingCanvasRef.current
        const snap = sourceSnapshotRef.current
        if (working && snap) {
          const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
          let prev = lastPointRef.current
          for (const ev of events) {
            const rect = overlayCanvasRef.current!.getBoundingClientRect()
            const pt: Point = {
              x: ((ev.clientX - rect.left) / rect.width) * imgW,
              y: ((ev.clientY - rect.top) / rect.height) * imgH,
            }
            cloneEngineRef.current.strokeSegment(
              snap,
              working,
              prev,
              pt,
              offset,
              cloneSize / 2,
              cloneFeather / 100,
              cloneOpacity / 100,
            )
            prev = pt
          }
          lastPointRef.current = prev
          currentMovingSourceRef.current = { x: prev.x + offset.x, y: prev.y + offset.y }
          setHasImageEdits(true)
          redrawBase()
        }
        redrawOverlay()
        return
      }

      // 未拖曳狀態下更新懸浮預覽
      redrawOverlay()
      return
    }

    if (!drawingRef.current) return

    if (drawMode === 'rect') {
      currentDragPointRef.current = p
      redrawOverlay()
      return
    }

    const stroke = currentStrokeRef.current
    const last = lastPointRef.current
    if (!stroke || !last) return

    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
    const ctx = maskCanvas.getContext('2d')!
    let prev = last
    for (const ev of events) {
      const rect = overlayCanvasRef.current!.getBoundingClientRect()
      const pt: Point = {
        x: ((ev.clientX - rect.left) / rect.width) * imgW,
        y: ((ev.clientY - rect.top) / rect.height) * imgH,
      }
      const segment: Stroke = { points: [prev, pt], radius: stroke.radius, erase: stroke.erase }
      drawStroke(ctx, segment)
      stroke.points.push(pt)
      prev = pt
    }
    lastPointRef.current = prev
    redrawOverlay()
  }

  const finishStroke = () => {
    if (drawMode === 'clone') {
      if (isDraggingSourceRef.current) {
        isDraggingSourceRef.current = false
        drawingRef.current = false
        setToastMessage('✅ 取樣點已更新')
        redrawOverlay()
        return
      }

      if (isStampingRef.current) {
        isStampingRef.current = false
        drawingRef.current = false
        if (cloneAligned && currentMovingSourceRef.current) {
          // 連動對齊：取樣點更新至筆劃結尾的來源位置
          setSourcePoint({ ...currentMovingSourceRef.current })
        }
        currentMovingSourceRef.current = null
        lastPointRef.current = null
        redrawOverlay()
        return
      }
    }

    if (!drawingRef.current) return
    drawingRef.current = false

    if (drawMode === 'rect' && startPointRef.current && currentDragPointRef.current) {
      const sp = startPointRef.current
      const ep = currentDragPointRef.current
      const x = Math.min(sp.x, ep.x)
      const y = Math.min(sp.y, ep.y)
      const w = Math.abs(sp.x - ep.x)
      const h = Math.abs(sp.y - ep.y)

      if (w > 2 && h > 2) {
        recordHistory('mask')
        const ctx = maskCanvas.getContext('2d')!
        ctx.save()
        ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over'
        ctx.fillStyle = '#fff'
        ctx.fillRect(x, y, w, h)
        ctx.restore()

        const rectStroke: Stroke = {
          points: [
            { x, y },
            { x: x + w, y },
            { x: x + w, y: y + h },
            { x, y: y + h },
            { x, y },
          ],
          radius: Math.max(w, h) / 2,
          erase: eraser,
        }
        strokesRef.current.push(rectStroke)
        setHasMask(true)
      }
      startPointRef.current = null
      currentDragPointRef.current = null
      redrawOverlay()
      return
    }

    const stroke = currentStrokeRef.current
    currentStrokeRef.current = null
    lastPointRef.current = null
    if (stroke && stroke.points.length > 0) {
      strokesRef.current.push(stroke)
      if (strokesRef.current.length > MAX_UNDO) strokesRef.current.shift()
    }
  }

  const undo = () => {
    const history = historyRef.current
    if (history.length === 0) return
    const lastStep = history.pop()
    setHistoryCount(history.length)

    if (lastStep?.type === 'clone' && lastStep.data && workingCanvasRef.current) {
      const wCtx = workingCanvasRef.current.getContext('2d')!
      wCtx.putImageData(lastStep.data, 0, 0)
      redrawBase()
      const hasRemainingClone = history.some((h) => h.type === 'clone')
      setHasImageEdits(hasRemainingClone)
    } else if (lastStep?.type === 'mask' && lastStep.data) {
      const mCtx = maskCanvas.getContext('2d')!
      mCtx.putImageData(lastStep.data, 0, 0)
      setHasMask(maskHasContent(maskCanvas))
    }
    redrawOverlay()
  }

  const clearMaskOnly = () => {
    recordHistory('mask')
    const ctx = maskCanvas.getContext('2d')!
    ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
    strokesRef.current = []
    setHasMask(false)
    redrawOverlay()
  }

  const revertImageToOriginal = () => {
    if (!workingCanvasRef.current) return
    recordHistory('clone')
    const ctx = workingCanvasRef.current.getContext('2d')!
    ctx.clearRect(0, 0, imgW, imgH)
    ctx.drawImage(image, 0, 0)
    setHasImageEdits(false)
    redrawBase()
    redrawOverlay()
    setToastMessage('已還原為原始未修復圖片底圖')
  }

  const handleApplyCrop = (croppedImg: HTMLImageElement, croppedMask?: HTMLCanvasElement) => {
    strokesRef.current = []
    historyRef.current = []
    setHistoryCount(0)
    setSourcePoint(null)
    setHasImageEdits(false)
    setIsCropping(false)
    onCrop(croppedImg, croppedMask)
  }

  return (
    <div className="mask-editor">
      <div className="toolbar">
        {/* 工具列模式選擇 */}
        <div className="tool-selector">
          <button
            type="button"
            className="tool-btn ai-magic-btn"
            onClick={handleAutoScan}
            disabled={isScanning}
            title="利用電腦視覺演算法自動掃描全圖浮水印與文字"
          >
            {isScanning ? '⚡ 掃描中…' : '⚡ AI 全圖掃描'}
          </button>
          <button
            type="button"
            className={`tool-btn${drawMode === 'clone' ? ' active' : ''}`}
            onClick={() => {
              setDrawMode('clone')
              setEraser(false)
            }}
            title="克隆圖章 (Clone Stamp)：取樣周邊乾淨紋理，手動無痕塗抹覆蓋浮水印"
          >
            🎯 克隆圖章
          </button>
          <button
            type="button"
            className={`tool-btn${drawMode === 'brush' && !eraser ? ' active' : ''}`}
            onClick={() => {
              setDrawMode('brush')
              setEraser(false)
            }}
            title="自由塗抹欲去除的浮水印區域"
          >
            🖌️ 塗抹標記
          </button>
          <button
            type="button"
            className={`tool-btn${drawMode === 'magic' && !eraser ? ' active' : ''}`}
            onClick={() => {
              setDrawMode('magic')
              setEraser(false)
            }}
            title="點擊浮水印文字任一處，自動貼合輪廓圈選"
          >
            🪄 AI 點選圈選
          </button>
          <button
            type="button"
            className={`tool-btn${drawMode === 'rect' && !eraser ? ' active' : ''}`}
            onClick={() => {
              setDrawMode('rect')
              setEraser(false)
            }}
            title="拖曳框選快速標記矩形浮水印/台標"
          >
            🔲 快速框選
          </button>
          <button
            type="button"
            className={`tool-btn${eraser ? ' active' : ''}`}
            onClick={() => {
              setEraser((v) => !v)
              if (drawMode === 'clone') setDrawMode('brush')
            }}
            title="橡皮擦：擦除已塗抹的標記遮罩"
          >
            🧹 橡皮擦
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={() => setIsCropping(true)}
            title="裁切目前圖片尺寸"
          >
            ✂️ 裁切圖片
          </button>
        </div>

        {/* 筆刷大小滑桿（塗抹標記專用） */}
        {drawMode === 'brush' && (
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
        )}

        {/* AI 點選圈選容許度滑桿 */}
        {drawMode === 'magic' && (
          <label className="brush-control" title="調整 AI 點選時擴散選取的敏感度">
            選取容許度 (閾值)
            <input
              type="range"
              min={5}
              max={100}
              value={magicTolerance}
              onChange={(e) => setMagicTolerance(Number(e.target.value))}
            />
            <span className="brush-value">{magicTolerance}</span>
          </label>
        )}

        <div className="toolbar-buttons">
          <button
            type="button"
            onClick={undo}
            disabled={historyCount === 0}
            title="復原上一步動作 (Ctrl+Z)"
          >
            復原
          </button>
          <button
            type="button"
            onClick={clearMaskOnly}
            disabled={!hasMask}
            title="清空紅色塗抹標記"
          >
            清除標記
          </button>
          {hasImageEdits && (
            <button
              type="button"
              onClick={revertImageToOriginal}
              className="btn-revert"
              title="還原所有克隆圖章修改，恢復原始底圖"
            >
              重設底圖
            </button>
          )}
        </div>
      </div>

      {/* ---------- 克隆圖章 (Clone Stamp) 專屬獨立操作控制列 ---------- */}
      {drawMode === 'clone' && (
        <div className="clone-toolbar-section">
          <div className="clone-controls-row">
            {/* 取樣 vs 塗抹雙模式切換（手機無按鍵核心操作） */}
            <div className="clone-submode-group" role="group" aria-label="克隆模式切換">
              <button
                type="button"
                className={`clone-mode-btn${cloneSubMode === 'sample' || isAltPressed ? ' active' : ''}`}
                onClick={() => setCloneSubMode('sample')}
                title="點選圖片上的無痕乾淨區域作為取樣來源 (電腦版可長按 Alt 鍵)"
              >
                🎯 設定取樣點
              </button>
              <button
                type="button"
                className={`clone-mode-btn${cloneSubMode === 'stamp' && !isAltPressed ? ' active' : ''}`}
                onClick={() => {
                  if (!sourcePoint) {
                    alert('請先在畫面上點選一個乾淨無水印的區域作為取樣點！')
                    return
                  }
                  setCloneSubMode('stamp')
                }}
                title="在浮水印上滑動塗抹覆蓋消除"
              >
                🖌️ 塗抹克隆
              </button>
            </div>

            {/* 筆刷大小調節 + 手機極速預設值 */}
            <div className="clone-param-group">
              <label className="brush-control">
                大小
                <input
                  type="range"
                  min={5}
                  max={250}
                  value={cloneSize}
                  onChange={(e) => setCloneSize(Number(e.target.value))}
                />
                <span className="brush-value">{cloneSize}px</span>
              </label>
              <div className="preset-chips">
                {[15, 30, 60, 100].map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    className={`chip-btn${cloneSize === sz ? ' active' : ''}`}
                    onClick={() => setCloneSize(sz)}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>

            {/* 柔邊程度調節 (Feathering) + 手機極速預設值 */}
            <div className="clone-param-group" title="柔邊程度越高，修復邊界融合越自然無痕">
              <label className="brush-control">
                柔邊
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={cloneFeather}
                  onChange={(e) => setCloneFeather(Number(e.target.value))}
                />
                <span className="brush-value">{cloneFeather}%</span>
              </label>
              <div className="preset-chips">
                {[
                  { label: '硬邊 0%', val: 0 },
                  { label: '微柔 30%', val: 30 },
                  { label: '柔邊 60%', val: 60 },
                  { label: '超柔 90%', val: 90 },
                ].map((item) => (
                  <button
                    key={item.val}
                    type="button"
                    className={`chip-btn${cloneFeather === item.val ? ' active' : ''}`}
                    onClick={() => setCloneFeather(item.val)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 不透明度調節 */}
            <label className="brush-control" title="調整每次塗抹克隆的覆蓋不透明度">
              不透明
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={cloneOpacity}
                onChange={(e) => setCloneOpacity(Number(e.target.value))}
              />
              <span className="brush-value">{cloneOpacity}%</span>
            </label>

            {/* 連動對齊開關 */}
            <label
              className="checkbox-control"
              title="連動對齊：下筆時依據相對距離連續複製周圍紋理；取消則每次下筆皆從原始取樣點重複複製"
            >
              <input
                type="checkbox"
                checked={cloneAligned}
                onChange={(e) => setCloneAligned(e.target.checked)}
              />
              <span>連動對齊</span>
            </label>
          </div>

          {/* 手機直覺操作提示橫幅 */}
          <div className="clone-tip-banner">
            <span className="tip-icon">💡</span>
            <span className="tip-text">
              {cloneSubMode === 'sample' || !sourcePoint
                ? '請點擊畫面上乾淨無水印的紋理作為取樣點 (電腦版可隨時按住 Alt 鍵點擊)'
                : '手機觸控：直接塗抹浮水印即可無痕覆蓋！也可直接用手指按住 🎯 準心拖曳換位。'}
            </span>
            {sourcePoint && (
              <button
                type="button"
                className="resample-btn"
                onClick={() => {
                  setCloneSubMode('sample')
                  setToastMessage('請點選新的取樣位置')
                }}
              >
                🔄 重新取樣
              </button>
            )}
          </div>
        </div>
      )}

      {/* 臨時互動回饋 Toast */}
      {toastMessage && <div className="clone-toast">{toastMessage}</div>}

      <div ref={containerRef} className="canvas-container">
        <div
          className="canvas-stack"
          style={{ width: displaySize.w || undefined, height: displaySize.h || undefined }}
        >
          {/* 底層：可實時顯示克隆圖章塗抹效果的底圖畫布 */}
          <canvas ref={baseCanvasRef} className="base-canvas" />

          {/* 上層：互動捕捉、遮罩、準星與筆刷預覽 */}
          <canvas
            ref={overlayCanvasRef}
            className={`overlay-canvas${eraser ? ' erasing' : ''}${
              drawMode === 'clone' && (cloneSubMode === 'sample' || isAltPressed)
                ? ' clone-sampling'
                : drawMode === 'clone'
                  ? ' clone-stamping'
                  : ''
            }`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finishStroke}
            onPointerCancel={finishStroke}
            onPointerLeave={() => {
              hoverPointRef.current = null
              redrawOverlay()
            }}
          />
        </div>
      </div>

      <div className="action-bar">
        <button type="button" className="secondary" onClick={onBack}>
          換一張圖片
        </button>

        {hasMask ? (
          <button
            type="button"
            className="primary"
            onClick={() => onProcess(workingCanvasRef.current || undefined)}
          >
            開始去除浮水印 (AI Inpaint)
          </button>
        ) : hasImageEdits ? (
          <button
            type="button"
            className="primary clone-finish-btn"
            onClick={() => {
              if (workingCanvasRef.current) {
                onCompleteWithoutInpaint?.(workingCanvasRef.current)
              }
            }}
          >
            ✨ 完成克隆修復 (檢視成果)
          </button>
        ) : (
          <button type="button" className="primary" disabled>
            開始去除浮水印
          </button>
        )}
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
  )
}
