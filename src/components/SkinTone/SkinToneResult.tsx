import { useEffect, useRef, useState } from 'react'

interface SkinToneResultProps {
  image: HTMLImageElement
  fileName?: string
  resultCanvas: HTMLCanvasElement
  onContinueEditing: () => void
  onReset: () => void
}

function getBaseName(fileName?: string): string {
  if (!fileName) return 'image'
  return fileName.replace(/\.[^/.]+$/, '') || 'image'
}

/** 前 / 後對比檢視：拖曳中間滑桿比較原圖與膚色調和後的成果 */
export default function SkinToneResult({
  image,
  fileName,
  resultCanvas,
  onContinueEditing,
  onReset,
}: SkinToneResultProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const beforeRef = useRef<HTMLCanvasElement>(null)
  const afterRef = useRef<HTMLCanvasElement>(null)
  const [position, setPosition] = useState(50) // 百分比：左邊顯示調和後，右邊顯示原圖
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
      const base = getBaseName(fileName)
      a.download = `${base}_st.png`
      a.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  return (
    <div className="result-view skin-tone-result">
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
        <span className="compare-label label-after">調和後</span>
      </div>
      <p className="hint-text">拖曳中間的分隔線比較前後膚色差異</p>

      <div className="action-bar">
        <button type="button" className="secondary" onClick={onReset}>
          換一張圖片
        </button>
        <button type="button" className="secondary" onClick={onContinueEditing}>
          繼續微調
        </button>
        <button type="button" className="primary skin-primary-btn" onClick={downloadPng}>
          下載高清 PNG ({getBaseName(fileName)}_st.png)
        </button>
      </div>
    </div>
  )
}
