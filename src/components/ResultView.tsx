import { useEffect, useRef, useState } from 'react'

interface ResultViewProps {
  image: HTMLImageElement
  resultCanvas: HTMLCanvasElement
  /** 結果是否因大小限制被縮小過 */
  downscaled: boolean
  onContinueEditing: () => void
  onReset: () => void
}

/** 前 / 後對比檢視：拖曳中間滑桿比較原圖與去除後的結果 */
export default function ResultView({
  image,
  resultCanvas,
  downscaled,
  onContinueEditing,
  onReset,
}: ResultViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const beforeRef = useRef<HTMLCanvasElement>(null)
  const afterRef = useRef<HTMLCanvasElement>(null)
  const [position, setPosition] = useState(50) // 百分比：左邊顯示結果，右邊顯示原圖
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 })
  const draggingRef = useRef(false)

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

  // 繪製兩張圖（若結果被縮小過，原圖也繪製成相同解析度以便對齊）
  useEffect(() => {
    if (displaySize.w === 0) return
    const before = beforeRef.current
    const after = afterRef.current
    if (!before || !after) return
    before.width = displaySize.w
    before.height = displaySize.h
    before.getContext('2d')!.drawImage(image, 0, 0, displaySize.w, displaySize.h)
    after.width = displaySize.w
    after.height = displaySize.h
    after.getContext('2d')!.drawImage(resultCanvas, 0, 0, displaySize.w, displaySize.h)
  }, [image, resultCanvas, displaySize])

  const updatePosition = (clientX: number) => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const pct = ((clientX - rect.left) / rect.width) * 100
    setPosition(Math.min(100, Math.max(0, pct)))
  }

  const downloadPng = () => {
    resultCanvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'watermark-removed.png'
      a.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  return (
    <div className="result-view">
      {downscaled && (
        <p className="notice">原圖超過 2500px，結果已等比縮小至 {resW} × {resH}。</p>
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
        <button type="button" className="primary" onClick={downloadPng}>
          下載 PNG
        </button>
      </div>
    </div>
  )
}
