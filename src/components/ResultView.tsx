import { useEffect, useRef, useState } from 'react'
import type { GifContext, GifFrame } from '../lib/gifInpaint'

interface ResultViewProps {
  image: HTMLImageElement
  fileName?: string
  resultCanvas: HTMLCanvasElement
  /** 結果是否因大小限制被縮小過 */
  downscaled: boolean
  gifContext?: GifContext | null
  gifResult?: { cleanFrames: GifFrame[]; gifBlob: Blob } | null
  onContinueEditing: () => void
  onReset: () => void
}

function getBaseName(fileName?: string): string {
  if (!fileName) return 'image'
  return fileName.replace(/\.[^/.]+$/, '') || 'image'
}

/** 前 / 後對比檢視：支援靜態圖片對比與動態 GIF 逐幀同步即時播放對比 */
export default function ResultView({
  image,
  fileName,
  resultCanvas,
  downscaled,
  gifContext,
  gifResult,
  onContinueEditing,
  onReset,
}: ResultViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const beforeRef = useRef<HTMLCanvasElement>(null)
  const afterRef = useRef<HTMLCanvasElement>(null)
  const [position, setPosition] = useState(50) // 百分比：左邊顯示結果，右邊顯示原圖
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 })
  const draggingRef = useRef(false)

  const isGif = !!(gifContext && gifResult && gifContext.frames.length > 1)
  const frameIndexRef = useRef(0)

  const resW = resultCanvas.width
  const resH = resultCanvas.height

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const update = () => {
      const w = container.clientWidth
      if (w > 0) setDisplaySize({ w, h: Math.round((w * resH) / resW) })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => observer.disconnect()
  }, [resW, resH])

  // 1. 動態 GIF 逐幀即時播放循環
  useEffect(() => {
    if (!isGif || !gifContext || !gifResult || displaySize.w === 0) return

    let canceled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = () => {
      if (canceled) return
      const before = beforeRef.current
      const after = afterRef.current
      if (before && after) {
        const idx = frameIndexRef.current % gifContext.frames.length
        const origFrame = gifContext.frames[idx]
        const cleanFrame = gifResult.cleanFrames[idx]

        if (before.width !== displaySize.w || before.height !== displaySize.h) {
          before.width = displaySize.w
          before.height = displaySize.h
        }
        if (after.width !== displaySize.w || after.height !== displaySize.h) {
          after.width = displaySize.w
          after.height = displaySize.h
        }

        const bCtx = before.getContext('2d')!
        bCtx.clearRect(0, 0, displaySize.w, displaySize.h)
        bCtx.drawImage(origFrame.canvas, 0, 0, displaySize.w, displaySize.h)

        const aCtx = after.getContext('2d')!
        aCtx.clearRect(0, 0, displaySize.w, displaySize.h)
        aCtx.drawImage(cleanFrame.canvas, 0, 0, displaySize.w, displaySize.h)

        frameIndexRef.current = (idx + 1) % gifContext.frames.length
        timer = setTimeout(tick, origFrame.delay || 100)
      }
    }

    tick()

    return () => {
      canceled = true
      if (timer) clearTimeout(timer)
    }
  }, [isGif, gifContext, gifResult, displaySize])

  // 2. 常規靜態圖片繪製
  useEffect(() => {
    if (isGif || displaySize.w === 0) return
    const before = beforeRef.current
    const after = afterRef.current
    if (!before || !after) return
    before.width = displaySize.w
    before.height = displaySize.h
    before.getContext('2d')!.drawImage(image, 0, 0, displaySize.w, displaySize.h)
    after.width = displaySize.w
    after.height = displaySize.h
    after.getContext('2d')!.drawImage(resultCanvas, 0, 0, displaySize.w, displaySize.h)
  }, [image, resultCanvas, displaySize, isGif])

  const updatePosition = (clientX: number) => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const pct = ((clientX - rect.left) / rect.width) * 100
    setPosition(Math.min(100, Math.max(0, pct)))
  }

  const handleDownload = () => {
    const base = getBaseName(fileName)
    if (isGif && gifResult) {
      // 下載動態 GIF
      const url = URL.createObjectURL(gifResult.gifBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${base}_wr.gif`
      a.click()
      URL.revokeObjectURL(url)
    } else {
      // 下載靜態 PNG
      resultCanvas.toBlob((blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${base}_wr.png`
        a.click()
        URL.revokeObjectURL(url)
      }, 'image/png')
    }
  }

  return (
    <div className="result-view">
      {downscaled && (
        <p className="notice">原圖超過 2500px，結果已等比縮小至 {resW} × {resH}。</p>
      )}

      {isGif && (
        <div className="gif-live-badge">
          ✨ 正在以每秒 {Math.round(1000 / (gifContext?.frames[0]?.delay || 100))} 幀即時循環播放動態去除成果！
        </div>
      )}

      <div
        ref={containerRef}
        className="compare-container"
        style={{ height: displaySize.h || undefined }}
        onPointerDown={(e) => {
          draggingRef.current = true
          ;(e.target as Element).setPointerCapture(e.pointerId)
          updatePosition(e.clientX)
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) updatePosition(e.clientX)
        }}
        onPointerUp={() => {
          draggingRef.current = false
        }}
        onPointerCancel={() => {
          draggingRef.current = false
        }}
      >
        <canvas ref={beforeRef} className="compare-layer" />
        <div className="compare-clip" style={{ width: `${position}%` }}>
          <canvas
            ref={afterRef}
            className="compare-layer"
            style={{ width: displaySize.w || undefined }}
          />
        </div>
        <div className="compare-divider" style={{ left: `${position}%` }} />
        <span className="compare-label label-before">原圖</span>
        <span className="compare-label label-after">去除後</span>
      </div>
      <p className="hint-text">拖曳中間的分隔線比較前後差異</p>

      <div className="action-bar">
        <button type="button" className="secondary" onClick={onReset}>
          換一張圖片
        </button>
        <button type="button" className="secondary" onClick={onContinueEditing}>
          繼續編輯
        </button>
        <button type="button" className="primary" onClick={handleDownload}>
          {isGif ? '💾 下載動態 GIF' : '下載 PNG'}
        </button>
      </div>
    </div>
  )
}
