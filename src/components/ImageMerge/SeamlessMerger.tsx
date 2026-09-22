import { useCallback, useEffect, useRef, useState } from 'react'

type Direction = 'horizontal' | 'vertical'

interface ImageTransform {
  scale: number
  offsetX: number
  offsetY: number
}

interface SeamlessMergerProps {
  imageA: HTMLImageElement
  imageB: HTMLImageElement
  onExportReady: (exportCanvas: HTMLCanvasElement) => void
}

export default function SeamlessMerger({
  imageA,
  imageB,
  onExportReady,
}: SeamlessMergerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [direction, setDirection] = useState<Direction>('horizontal')
  const [splitRatio, setSplitRatio] = useState(50) // 10% ~ 90%
  const [feather, setFeather] = useState(0) // 0px ~ 40px
  const [activeSide, setActiveSide] = useState<'A' | 'B'>('A')

  // 兩圖獨立縮放與位移
  const [transformA, setTransformA] = useState<ImageTransform>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  })
  const [transformB, setTransformB] = useState<ImageTransform>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  })

  // 畫布在螢幕上的縮放尺寸
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 })

  // 拖曳狀態
  const dragRef = useRef<{
    startX: number
    startY: number
    target: 'A' | 'B'
    initOffsetX: number
    initOffsetY: number
  } | null>(null)

  // 計算輸出畫布的基準尺寸（以較大圖片為基準保證最高清晰度）
  const baseW = Math.max(imageA.naturalWidth, imageB.naturalWidth)
  const baseH = Math.max(imageA.naturalHeight, imageB.naturalHeight)

  const updateDisplaySize = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const cw = container.clientWidth
    if (cw <= 0) return
    const ch = Math.round((cw * baseH) / baseW)
    setDisplaySize({ w: cw, h: ch })
  }, [baseW, baseH])

  useEffect(() => {
    updateDisplaySize()
    const observer = new ResizeObserver(updateDisplaySize)
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [updateDisplaySize])

  // 繪製與匯出
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || displaySize.w === 0) return

    canvas.width = baseW
    canvas.height = baseH
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, baseW, baseH)

    const isHoriz = direction === 'horizontal'
    const splitPos = isHoriz
      ? Math.round((baseW * splitRatio) / 100)
      : Math.round((baseH * splitRatio) / 100)

    // 1. 繪製圖 A (含裁剪與獨立變形)
    ctx.save()
    ctx.beginPath()
    if (isHoriz) {
      ctx.rect(0, 0, splitPos, baseH)
    } else {
      ctx.rect(0, 0, baseW, splitPos)
    }
    ctx.clip()

    // 依縮放與位移繪製 Image A
    ctx.save()
    const scaleA = transformA.scale
    const drawWA = Math.round(imageA.naturalWidth * scaleA)
    const drawHA = Math.round(imageA.naturalHeight * scaleA)
    const posXA = Math.round((baseW / 2 - drawWA / 2) + transformA.offsetX)
    const posYA = Math.round((baseH / 2 - drawHA / 2) + transformA.offsetY)
    ctx.drawImage(imageA, posXA, posYA, drawWA, drawHA)
    ctx.restore()
    ctx.restore()

    // 2. 繪製圖 B (含裁剪與獨立變形)
    ctx.save()
    ctx.beginPath()
    if (isHoriz) {
      ctx.rect(splitPos, 0, baseW - splitPos, baseH)
    } else {
      ctx.rect(0, splitPos, baseW, baseH - splitPos)
    }
    ctx.clip()

    ctx.save()
    const scaleB = transformB.scale
    const drawWB = Math.round(imageB.naturalWidth * scaleB)
    const drawHB = Math.round(imageB.naturalHeight * scaleB)
    const posXB = Math.round((baseW / 2 - drawWB / 2) + transformB.offsetX)
    const posYB = Math.round((baseH / 2 - drawHB / 2) + transformB.offsetY)
    ctx.drawImage(imageB, posXB, posYB, drawWB, drawHB)
    ctx.restore()
    ctx.restore()

    // 3. 若有接縫羽化，繪製微幅平滑漸變融合帶
    if (feather > 0) {
      ctx.save()
      const fDist = Math.round((feather / 100) * (isHoriz ? baseW * 0.15 : baseH * 0.15))
      const grad = isHoriz
        ? ctx.createLinearGradient(splitPos - fDist, 0, splitPos + fDist, 0)
        : ctx.createLinearGradient(0, splitPos - fDist, 0, splitPos + fDist)

      grad.addColorStop(0, 'rgba(0,0,0,0)')
      grad.addColorStop(0.5, 'rgba(255,255,255,0.15)')
      grad.addColorStop(1, 'rgba(0,0,0,0)')

      ctx.fillStyle = grad
      if (isHoriz) {
        ctx.fillRect(splitPos - fDist, 0, fDist * 2, baseH)
      } else {
        ctx.fillRect(0, splitPos - fDist, baseW, fDist * 2)
      }
      ctx.restore()
    }

    onExportReady(canvas)
  }, [
    baseW,
    baseH,
    displaySize,
    direction,
    splitRatio,
    feather,
    imageA,
    imageB,
    transformA,
    transformB,
    onExportReady,
  ])

  useEffect(() => {
    renderCanvas()
  }, [renderCanvas])

  // 滑鼠拖曳控制平移
  const handlePointerDown = (e: React.PointerEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top

    const isHoriz = direction === 'horizontal'
    const splitRatioLocal = splitRatio / 100
    const inA = isHoriz ? cx < rect.width * splitRatioLocal : cy < rect.height * splitRatioLocal
    const target = inA ? 'A' : 'B'
    setActiveSide(target)

    const curTransform = target === 'A' ? transformA : transformB
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      target,
      initOffsetX: curTransform.offsetX,
      initOffsetY: curTransform.offsetY,
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const { startX, startY, target, initOffsetX, initOffsetY } = dragRef.current
    const dx = e.clientX - startX
    const dy = e.clientY - startY

    // 換算為輸出畫布像素
    const scaleFactor = baseW / displaySize.w
    const deltaX = dx * scaleFactor
    const deltaY = dy * scaleFactor

    if (target === 'A') {
      setTransformA((prev) => ({
        ...prev,
        offsetX: Math.round(initOffsetX + deltaX),
        offsetY: Math.round(initOffsetY + deltaY),
      }))
    } else {
      setTransformB((prev) => ({
        ...prev,
        offsetX: Math.round(initOffsetX + deltaX),
        offsetY: Math.round(initOffsetY + deltaY),
      }))
    }
  }

  const handlePointerUp = () => {
    dragRef.current = null
  }

  const handleResetActive = () => {
    if (activeSide === 'A') {
      setTransformA({ scale: 1, offsetX: 0, offsetY: 0 })
    } else {
      setTransformB({ scale: 1, offsetX: 0, offsetY: 0 })
    }
  }

  const currentScale = activeSide === 'A' ? transformA.scale : transformB.scale

  const handleScaleChange = (val: number) => {
    if (activeSide === 'A') {
      setTransformA((prev) => ({ ...prev, scale: val }))
    } else {
      setTransformB((prev) => ({ ...prev, scale: val }))
    }
  }

  return (
    <div className="seamless-merger">
      <div className="toolbar merge-toolbar">
        {/* 拼接方向 */}
        <div className="tool-selector">
          <button
            type="button"
            className={`tool-btn${direction === 'horizontal' ? ' active' : ''}`}
            onClick={() => setDirection('horizontal')}
          >
            ↔️ 左右拼接
          </button>
          <button
            type="button"
            className={`tool-btn${direction === 'vertical' ? ' active' : ''}`}
            onClick={() => setDirection('vertical')}
          >
            ↕️ 上下拼接
          </button>
        </div>

        {/* 控制對象切換 */}
        <div className="tool-selector">
          <button
            type="button"
            className={`tool-btn${activeSide === 'A' ? ' active' : ''}`}
            onClick={() => setActiveSide('A')}
          >
            📷 控制圖 A
          </button>
          <button
            type="button"
            className={`tool-btn${activeSide === 'B' ? ' active' : ''}`}
            onClick={() => setActiveSide('B')}
          >
            📷 控制圖 B
          </button>
          <button type="button" className="tool-btn" onClick={handleResetActive} title="重設選中圖片的位置與縮放">
            ↩️ 重設位置
          </button>
        </div>
      </div>

      {/* 滑桿列 */}
      <div className="sliders-bar merge-sliders">
        <label className="brush-control" title="調整兩張圖片在畫面中的佔比">
          分割比例
          <input
            type="range"
            min={10}
            max={90}
            value={splitRatio}
            onChange={(e) => setSplitRatio(Number(e.target.value))}
          />
          <span className="brush-value">
            {splitRatio} : {100 - splitRatio}
          </span>
        </label>

        <label className="brush-control" title="調整當前選中圖片的縮放比例">
          圖 {activeSide} 縮放
          <input
            type="range"
            min={0.2}
            max={3.0}
            step={0.05}
            value={currentScale}
            onChange={(e) => handleScaleChange(Number(e.target.value))}
          />
          <span className="brush-value">{Math.round(currentScale * 100)}%</span>
        </label>

        <label className="brush-control" title="接縫處平滑漸變融合">
          接縫過渡
          <input
            type="range"
            min={0}
            max={40}
            value={feather}
            onChange={(e) => setFeather(Number(e.target.value))}
          />
          <span className="brush-value">{feather}px</span>
        </label>
        <span className="hint-text">在畫布上直接滑動可拖曳平移圖 A 或圖 B</span>
      </div>

      {/* 畫布容器 */}
      <div ref={containerRef} className="canvas-container">
        <div
          className="canvas-stack checkerboard-bg interactive"
          style={{ width: displaySize.w || undefined, height: displaySize.h || undefined }}
        >
          <canvas
            ref={canvasRef}
            className="merge-display-canvas"
            style={{ width: '100%', height: '100%' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        </div>
      </div>
    </div>
  )
}
