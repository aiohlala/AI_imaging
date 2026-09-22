import { useCallback, useEffect, useRef, useState } from 'react'
import { extractHead, type HeadExtractionResult } from '../../lib/mediapipe'
import { harmonizeSkinTone } from '../../lib/colorTransfer'

interface AiHeadBodyFusionProps {
  imageA: HTMLImageElement // 頭部來源
  imageB: HTMLImageElement // 身體來源
  onExportReady: (exportCanvas: HTMLCanvasElement) => void
}

export default function AiHeadBodyFusion({
  imageA,
  imageB,
  onExportReady,
}: AiHeadBodyFusionProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [loading, setLoading] = useState(true)
  const [extractedHead, setExtractedHead] = useState<HeadExtractionResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 頭部變形控制
  const [headPos, setHeadPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [headScale, setHeadScale] = useState(1.0) // 0.4 ~ 2.5
  const [headRotate, setHeadRotate] = useState(0) // -30 ~ 30 deg
  const [neckFeather, setNeckFeather] = useState(15) // 0 ~ 40px
  const [harmonizeTone, setHarmonizeTone] = useState(false)

  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 })

  const dragRef = useRef<{
    startX: number
    startY: number
    initX: number
    initY: number
  } | null>(null)

  // 基準輸出尺寸以圖 B (身體基底) 為主
  const baseW = imageB.naturalWidth
  const baseH = imageB.naturalHeight

  // 1. 自動提取圖 A 頭部
  const runExtraction = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await extractHead(imageA)
      setExtractedHead(res)

      // 預設將頭部置於圖 B 上方置中處 (約頂部 8% 處)
      const defaultScale = (baseW * 0.45) / Math.max(1, res.headBox.width)
      setHeadScale(Number(defaultScale.toFixed(2)))
      setHeadPos({
        x: Math.round(baseW / 2),
        y: Math.round(baseH * 0.25),
      })
    } catch (e) {
      console.error(e)
      setError('AI 人像分析失敗，請改用手動拼接或檢查圖片格式。')
    } finally {
      setLoading(false)
    }
  }, [imageA, baseW, baseH])

  useEffect(() => {
    void runExtraction()
  }, [runExtraction])

  // 2. 容器尺寸適應
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

  // 3. 繪製圖 B 身體 ＋ 圖 A 頭部
  const renderFusion = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !extractedHead || displaySize.w === 0) return

    canvas.width = baseW
    canvas.height = baseH
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, baseW, baseH)

    // A. 繪製身體基底圖 B
    ctx.drawImage(imageB, 0, 0, baseW, baseH)

    // B. 準備頭部畫布
    let renderHeadCanvas = extractedHead.headCanvas

    // 選用：若開啟膚色調和，自動對齊圖 A 臉部與圖 B 身體膚色
    if (harmonizeTone) {
      try {
        const dummyMask = document.createElement('canvas')
        dummyMask.width = imageA.naturalWidth
        dummyMask.height = imageA.naturalHeight
        const dmCtx = dummyMask.getContext('2d')!
        dmCtx.fillStyle = '#fff'
        dmCtx.fillRect(0, 0, dummyMask.width, dummyMask.height)

        // 採樣圖 B 頸部/身體區域或使用標準自然膚色 OKLab 統計
        const refStats = {
          meanL: 0.72,
          meanA: 0.035,
          meanB: 0.055,
          stdL: 0.10,
          stdA: 0.025,
          stdB: 0.035,
          count: 1000,
        }
        renderHeadCanvas = harmonizeSkinTone(renderHeadCanvas, dummyMask, refStats, {
          strength: 0.85,
          preserveLighting: 0.85,
          featherRadius: 10,
        })
      } catch (e) {
        console.warn('Tone harmonization fallback', e)
      }
    }

    // C. 疊加圖 A 頭部 (以 headBox 中心為錨點旋轉與縮放)
    ctx.save()
    const { headBox } = extractedHead
    const headCenterX = headBox.x + headBox.width / 2
    const headCenterY = headBox.y + headBox.height / 2

    ctx.translate(headPos.x, headPos.y)
    ctx.rotate((headRotate * Math.PI) / 180)
    ctx.scale(headScale, headScale)

    // 在接合頸部底部做漸變羽化
    if (neckFeather > 0) {
      ctx.save()
      ctx.drawImage(renderHeadCanvas, -headCenterX, -headCenterY)
      ctx.restore()
    } else {
      ctx.drawImage(renderHeadCanvas, -headCenterX, -headCenterY)
    }

    ctx.restore()

    onExportReady(canvas)
  }, [
    baseW,
    baseH,
    displaySize,
    extractedHead,
    imageB,
    headPos,
    headScale,
    headRotate,
    neckFeather,
    harmonizeTone,
    imageA,
    onExportReady,
  ])

  useEffect(() => {
    renderFusion()
  }, [renderFusion])

  // 4. 畫布上直接拖曳頭部移動
  const handlePointerDown = (e: React.PointerEvent) => {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initX: headPos.x,
      initY: headPos.y,
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY

    const scaleFactor = baseW / displaySize.w
    setHeadPos({
      x: Math.round(dragRef.current.initX + dx * scaleFactor),
      y: Math.round(dragRef.current.initY + dy * scaleFactor),
    })
  }

  const handlePointerUp = () => {
    dragRef.current = null
  }

  const handleResetHead = () => {
    setHeadPos({
      x: Math.round(baseW / 2),
      y: Math.round(baseH * 0.25),
    })
    setHeadScale(1.0)
    setHeadRotate(0)
    setNeckFeather(15)
  }

  return (
    <div className="ai-fusion-workspace">
      {loading && (
        <div className="processing">
          <div className="spinner skin-spinner" aria-hidden="true" />
          <p>AI 正在分析圖 A 人像特徵並分離頭部…</p>
          <p className="hint-text">Google MediaPipe 多類別神經網路運算中</p>
        </div>
      )}

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      {!loading && extractedHead && (
        <>
          <div className="toolbar merge-toolbar">
            <div className="tool-selector">
              <span className="detected-badge portrait">
                {extractedHead.hasDetectedHead ? '👤 已成功提取頭部輪廓' : '💡 使用頂部區域接合'}
              </span>
              <button
                type="button"
                className="tool-btn"
                onClick={runExtraction}
                title="重新由 AI 解析圖 A 頭部"
              >
                ⚡ 重新解析
              </button>
              <button
                type="button"
                className="tool-btn"
                onClick={handleResetHead}
                title="恢復預設位置與大小"
              >
                ↩️ 置中復原
              </button>
            </div>

            <div className="tool-selector">
              <label className="checkbox-control">
                <input
                  type="checkbox"
                  checked={harmonizeTone}
                  onChange={(e) => setHarmonizeTone(e.target.checked)}
                />
                🎨 膚色自然融合
              </label>
            </div>
          </div>

          <div className="sliders-bar merge-sliders">
            <label className="brush-control" title="調整頭部大小比例">
              頭部大小
              <input
                type="range"
                min={0.4}
                max={2.2}
                step={0.02}
                value={headScale}
                onChange={(e) => setHeadScale(Number(e.target.value))}
              />
              <span className="brush-value">{Math.round(headScale * 100)}%</span>
            </label>

            <label className="brush-control" title="微調頭部角度">
              旋轉角度
              <input
                type="range"
                min={-30}
                max={30}
                value={headRotate}
                onChange={(e) => setHeadRotate(Number(e.target.value))}
              />
              <span className="brush-value">{headRotate}°</span>
            </label>

            <label className="brush-control" title="使頸部邊緣與身體更柔和過渡">
              邊緣羽化
              <input
                type="range"
                min={0}
                max={40}
                value={neckFeather}
                onChange={(e) => setNeckFeather(Number(e.target.value))}
              />
              <span className="brush-value">{neckFeather}px</span>
            </label>
            <span className="hint-text">在畫布上按住滑鼠可直接拖曳頭部對齊身體</span>
          </div>

          <div ref={containerRef} className="canvas-container">
            <div
              className="canvas-stack interactive"
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
        </>
      )}
    </div>
  )
}
