import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  extractHead,
  analyzeTargetHead,
  type HeadExtractionResult,
  type TargetHeadAnalysis,
} from '../../lib/mediapipe'
import {
  renderHeadSwap,
  prepareHarmonizedHead,
  DEFAULT_HEAD_SWAP_CONFIG,
  type HeadSwapConfig,
} from '../../lib/headSwap'
import ImageCropperModal from '../ImageCropperModal'

interface HeadSwapViewerProps {
  headImage: HTMLImageElement
  headName: string
  targetImage: HTMLImageElement
  targetName: string
  onReset: () => void
  onUpdateImages?: (newHead?: HTMLImageElement, newTarget?: HTMLImageElement) => void
}

export default function HeadSwapViewer({
  headImage,
  headName,
  targetImage,
  targetName,
  onReset,
  onUpdateImages,
}: HeadSwapViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [extractedHead, setExtractedHead] = useState<HeadExtractionResult | null>(null)
  const [targetAnalysis, setTargetAnalysis] = useState<TargetHeadAnalysis | null>(null)
  const [config, setConfig] = useState<HeadSwapConfig>(DEFAULT_HEAD_SWAP_CONFIG)

  // 裁切視窗狀態 ('target' | 'head' | null)
  const [cropTarget, setCropTarget] = useState<'target' | 'head' | null>(null)

  // 前後對比滑桿 (0% ~ 100%，預設 50%)
  const [compareSplit, setCompareSplit] = useState(50)
  const [enableCompare, setEnableCompare] = useState(true)

  // 畫布顯示尺寸與拖曳狀態
  const [displaySize, setDisplaySize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const isDraggingHeadRef = useRef(false)
  const isDraggingSplitRef = useRef(false)
  const dragStartRef = useRef<{ clientX: number; clientY: number; startOffX: number; startOffY: number }>({
    clientX: 0,
    clientY: 0,
    startOffX: 0,
    startOffY: 0,
  })

  // 動畫影格與離線合成快取 (達成 60-120 FPS 順暢微調)
  const rafIdRef = useRef<number | null>(null)
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // 1. 初始化 AI 推論：分析目標與提取頭部
  useEffect(() => {
    let canceled = false
    async function runPipeline() {
      setLoading(true)
      setError(null)
      try {
        const [hResult, tAnalysis] = await Promise.all([
          extractHead(headImage),
          analyzeTargetHead(targetImage),
        ])
        if (canceled) return
        setExtractedHead(hResult)
        setTargetAnalysis(tAnalysis)
        setConfig((prev) => ({
          ...DEFAULT_HEAD_SWAP_CONFIG,
          flipH: prev.flipH, // 保留使用者選擇的翻轉狀態
        }))
      } catch (err) {
        if (canceled) return
        console.error(err)
        setError('AI 人像特徵分析失敗，請檢查圖片或更換人臉清晰的圖片。')
      } finally {
        if (!canceled) setLoading(false)
      }
    }
    void runPipeline()
    return () => {
      canceled = true
    }
  }, [headImage, targetImage])

  // 2. 獨立快取「已完成 OKLab 膚色調和之頭像畫布」
  // 核心效能關鍵：只有在膚色開關、調和強度或羽化變動時才重算！
  const cachedHarmonizedHead = useMemo(() => {
    if (!extractedHead || !targetAnalysis) return null
    return prepareHarmonizedHead(extractedHead.headCanvas, targetAnalysis, config)
  }, [
    extractedHead,
    targetAnalysis,
    config.harmonizeSkin,
    config.harmonizeStrength,
    config.feather,
  ])

  // 3. 自適應畫布容器尺寸
  const updateDisplaySize = useCallback(() => {
    const container = containerRef.current
    if (!container || !targetImage) return
    const containerWidth = container.clientWidth
    if (containerWidth <= 0) return
    const maxH = Math.max(300, window.innerHeight * 0.62)
    const targetW = targetImage.naturalWidth || 400
    const targetH = targetImage.naturalHeight || 520

    const scaleByW = containerWidth / targetW
    const scaleByH = maxH / targetH
    const fitScale = Math.min(scaleByW, scaleByH, 1.0)

    setDisplaySize({
      w: Math.round(targetW * fitScale),
      h: Math.round(targetH * fitScale),
    })
  }, [targetImage])

  useEffect(() => {
    if (loading || !extractedHead || !targetAnalysis) return
    updateDisplaySize()
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => updateDisplaySize())
    observer.observe(container)
    return () => observer.disconnect()
  }, [updateDisplaySize, loading, extractedHead, targetAnalysis])

  // 4. 即時繪製畫布（微秒級 GPU 硬體加速渲染）
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !extractedHead || !targetAnalysis || !cachedHarmonizedHead) return

    const targetW = targetImage.naturalWidth || 400
    const targetH = targetImage.naturalHeight || 520

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
    }
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, targetW, targetH)

    // A. 預備離線合成畫布 Buffer
    let offscreen = offscreenCanvasRef.current
    if (!offscreen) {
      offscreen = document.createElement('canvas')
      offscreenCanvasRef.current = offscreen
    }
    if (offscreen.width !== targetW || offscreen.height !== targetH) {
      offscreen.width = targetW
      offscreen.height = targetH
    }
    const offCtx = offscreen.getContext('2d')!
    offCtx.clearRect(0, 0, targetW, targetH)

    // 1. 底圖
    offCtx.drawImage(targetImage, 0, 0, targetW, targetH)

    // 2. 疊加頭部 (包含左右水平翻轉 scaleX)
    const baseScale = targetAnalysis.hasHead && extractedHead.headBox.width > 0
      ? (targetAnalysis.headBox.width / extractedHead.headBox.width)
      : (targetW * 0.38) / Math.max(1, extractedHead.headBox.width)

    const finalScale = baseScale * config.scale
    const srcHeadCenterX = extractedHead.headBox.x + extractedHead.headBox.width / 2
    const srcHeadCenterY = extractedHead.headBox.y + extractedHead.headBox.height / 2
    const destCenterX = targetAnalysis.center.x + config.offsetX
    const destCenterY = targetAnalysis.center.y + config.offsetY

    offCtx.save()
    offCtx.translate(destCenterX, destCenterY)
    if (config.rotation !== 0) {
      offCtx.rotate((config.rotation * Math.PI) / 180)
    }
    const scaleX = config.flipH ? -finalScale : finalScale
    const scaleY = finalScale
    offCtx.scale(scaleX, scaleY)
    offCtx.drawImage(cachedHarmonizedHead, -srcHeadCenterX, -srcHeadCenterY)
    offCtx.restore()

    // B. 繪製螢幕成果 (前後對比 or 全圖)
    if (!enableCompare) {
      ctx.drawImage(offscreen, 0, 0)
      return
    }

    const splitX = Math.round((targetW * compareSplit) / 100)

    // 成果 (After)
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, splitX, targetH)
    ctx.clip()
    ctx.drawImage(offscreen, 0, 0)
    ctx.restore()

    // 原圖 (Before)
    ctx.save()
    ctx.beginPath()
    ctx.rect(splitX, 0, targetW - splitX, targetH)
    ctx.clip()
    ctx.drawImage(targetImage, 0, 0)
    ctx.restore()

    // 中線與圓形把手
    ctx.save()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = Math.max(2, Math.round(targetW * 0.003))
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 6
    ctx.beginPath()
    ctx.moveTo(splitX, 0)
    ctx.lineTo(splitX, targetH)
    ctx.stroke()

    const handleY = targetH / 2
    const handleR = Math.max(14, Math.round(targetW * 0.016))
    ctx.fillStyle = '#6366f1'
    ctx.beginPath()
    ctx.arc(splitX, handleY, handleR, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = '#ffffff'
    ctx.font = `bold ${Math.round(handleR * 0.9)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('⬌', splitX, handleY)
    ctx.restore()
  }, [
    extractedHead,
    targetAnalysis,
    cachedHarmonizedHead,
    targetImage,
    config.scale,
    config.offsetX,
    config.offsetY,
    config.rotation,
    config.flipH,
    compareSplit,
    enableCompare,
  ])

  useEffect(() => {
    renderCanvas()
  }, [renderCanvas])

  // 5. requestAnimationFrame 流暢指針拖曳
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0) return
    const clickX = e.clientX - rect.left
    const currentSplitScreenX = (rect.width * compareSplit) / 100

    if (enableCompare && Math.abs(clickX - currentSplitScreenX) < 28) {
      isDraggingSplitRef.current = true
      canvas.setPointerCapture(e.pointerId)
      return
    }

    isDraggingHeadRef.current = true
    canvas.setPointerCapture(e.pointerId)
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      startOffX: config.offsetX,
      startOffY: config.offsetY,
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0) return

    if (isDraggingSplitRef.current) {
      const ratio = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)))
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = requestAnimationFrame(() => {
        setCompareSplit(ratio)
      })
      return
    }

    if (isDraggingHeadRef.current) {
      const scaleCoord = (targetImage.naturalWidth || canvas.width) / rect.width
      const dx = (e.clientX - dragStartRef.current.clientX) * scaleCoord
      const dy = (e.clientY - dragStartRef.current.clientY) * scaleCoord

      const nextX = Math.round(dragStartRef.current.startOffX + dx)
      const nextY = Math.round(dragStartRef.current.startOffY + dy)

      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = requestAnimationFrame(() => {
        setConfig((prev) => ({
          ...prev,
          offsetX: nextX,
          offsetY: nextY,
        }))
      })
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    const canvas = canvasRef.current
    if (canvas && (isDraggingHeadRef.current || isDraggingSplitRef.current)) {
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
    }
    isDraggingHeadRef.current = false
    isDraggingSplitRef.current = false
  }

  // 6. 下載高畫質成果
  const handleDownload = () => {
    if (!extractedHead || !targetAnalysis || !cachedHarmonizedHead) return
    const finalCanvas = renderHeadSwap(targetImage, extractedHead, targetAnalysis, config, cachedHarmonizedHead)
    const baseHeadName = headName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, '_')
    const baseTargetName = targetName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, '_')
    const filename = `${baseHeadName}_${baseTargetName}_headswap.png`

    const link = document.createElement('a')
    link.download = filename
    link.href = finalCanvas.toDataURL('image/png')
    link.click()
  }

  // 復原自動置中與縮放
  const handleResetAlignment = () => {
    setConfig((prev) => ({
      ...prev,
      scale: 1.0,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      flipH: false,
    }))
  }

  return (
    <div className="headswap-viewer-wrapper">
      {/* 頂部操作列 */}
      <div className="headswap-top-nav">
        <div className="status-indicator">
          <span className="sparkle-icon">✨</span>
          <span className="status-label">AI 人像自動換頭完成</span>
          {targetAnalysis?.hasHead ? (
            <span className="detected-tag">已精準貼合身型</span>
          ) : (
            <span className="detected-tag fallback">標準身型比例置中</span>
          )}
        </div>

        <div className="top-nav-actions">
          <button
            type="button"
            className="btn-nav-outline"
            onClick={() => setCropTarget('target')}
            title="裁切底圖身型比例"
          >
            ✂️ 裁切底圖
          </button>
          <button
            type="button"
            className="btn-nav-outline"
            onClick={() => setCropTarget('head')}
            title="裁切頭部人像來源"
          >
            ✂️ 裁切頭像
          </button>
          <button
            type="button"
            className={`btn-toggle-compare${enableCompare ? ' active' : ''}`}
            onClick={() => setEnableCompare(!enableCompare)}
          >
            {enableCompare ? '👀 關閉前後對比' : '⬌ 開啟前後對比'}
          </button>
          <button type="button" className="btn-nav-outline" onClick={handleResetAlignment} title="復原為自動對齊的位置與縮放">
            🎯 復原自動對位
          </button>
          <button type="button" className="btn-nav-danger" onClick={onReset} title="放棄並清空所有快取">
            ✕ 重新上傳並清空
          </button>
        </div>
      </div>

      {loading && (
        <div className="headswap-loading-box">
          <div className="spinner skin-spinner" aria-hidden="true" />
          <p className="loading-title">AI 正在深度定位目標身型與提取頭像…</p>
          <p className="loading-sub">Google MediaPipe WebAssembly/WebGPU 神經網路運算中</p>
        </div>
      )}

      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}

      {!loading && extractedHead && targetAnalysis && (
        <>
          {/* 微調控制器列 */}
          <div className="headswap-controls-bar">
            {/* 頭部大小 */}
            <label className="ctrl-item" title="調整頭部大小比例">
              <span className="ctrl-name">頭部大小</span>
              <input
                type="range"
                min={0.5}
                max={2.0}
                step={0.02}
                value={config.scale}
                onChange={(e) => setConfig((prev) => ({ ...prev, scale: Number(e.target.value) }))}
              />
              <span className="ctrl-val">{Math.round(config.scale * 100)}%</span>
            </label>

            {/* 1. 頭部左右水平翻轉按鈕 (緊鄰頭部大小) */}
            <button
              type="button"
              className={`ctrl-flip-btn${config.flipH ? ' active' : ''}`}
              onClick={() => setConfig((prev) => ({ ...prev, flipH: !prev.flipH }))}
              title="將頭部左右水平鏡射翻轉，完美匹配身體朝向"
            >
              <span className="flip-icon">⇄</span>
              <span>左右翻轉</span>
            </button>

            {/* 旋轉角度 */}
            <label className="ctrl-item" title="調整頭部傾斜旋轉角度">
              <span className="ctrl-name">旋轉角度</span>
              <input
                type="range"
                min={-30}
                max={30}
                step={1}
                value={config.rotation}
                onChange={(e) => setConfig((prev) => ({ ...prev, rotation: Number(e.target.value) }))}
              />
              <span className="ctrl-val">{config.rotation}°</span>
            </label>

            {/* 頸部邊緣羽化 */}
            <label className="ctrl-item" title="使頭部與頸部銜接處更柔和">
              <span className="ctrl-name">邊緣羽化</span>
              <input
                type="range"
                min={0}
                max={40}
                step={1}
                value={config.feather}
                onChange={(e) => setConfig((prev) => ({ ...prev, feather: Number(e.target.value) }))}
              />
              <span className="ctrl-val">{config.feather}px</span>
            </label>

            {/* 膚色自然調和 */}
            <label className="ctrl-checkbox-item" title="以 OKLab 色彩模型將頭部膚色光影自動調和對齊目標身體">
              <input
                type="checkbox"
                checked={config.harmonizeSkin}
                onChange={(e) => setConfig((prev) => ({ ...prev, harmonizeSkin: e.target.checked }))}
              />
              <span className="ctrl-checkbox-label">🎨 膚色光影調和</span>
            </label>

            {config.harmonizeSkin && (
              <label className="ctrl-item ctrl-mini" title="膚色調和強度">
                <input
                  type="range"
                  min={0.2}
                  max={1.0}
                  step={0.05}
                  value={config.harmonizeStrength}
                  onChange={(e) => setConfig((prev) => ({ ...prev, harmonizeStrength: Number(e.target.value) }))}
                />
                <span className="ctrl-val">{Math.round(config.harmonizeStrength * 100)}%</span>
              </label>
            )}

            <span className="drag-hint-tip">💡 在畫布上按住滑鼠可直接拖曳微調頭部位置</span>
          </div>

          {/* 畫布視窗 */}
          <div ref={containerRef} className="headswap-canvas-viewport">
            <div
              className="headswap-canvas-stage interactive"
              style={{
                width: displaySize.w > 0 ? displaySize.w : undefined,
                height: displaySize.h > 0 ? displaySize.h : undefined,
              }}
            >
              <canvas
                ref={canvasRef}
                className="headswap-interactive-canvas"
                style={{ width: '100%', height: '100%' }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              />
            </div>
          </div>

          {/* 底部下載與安全宣告 */}
          <div className="headswap-download-footer">
            <button type="button" className="btn-download-headswap" onClick={handleDownload}>
              💾 下載換頭成果 (高清 PNG)
            </button>
            <p className="zero-history-note">
              🛡️ 極致隱私保護：本頁面運算結果皆於當前瀏覽器記憶體中生成，未寫入任何伺服器或本地資料庫，關閉即刻清空。
            </p>
          </div>
        </>
      )}

      {/* 2. 成果檢視時內建裁切功能 (可裁切底圖或頭像) */}
      {cropTarget === 'target' && (
        <ImageCropperModal
          image={targetImage}
          onApply={(croppedImg) => {
            setCropTarget(null)
            if (onUpdateImages) onUpdateImages(undefined, croppedImg)
          }}
          onCancel={() => setCropTarget(null)}
        />
      )}

      {cropTarget === 'head' && (
        <ImageCropperModal
          image={headImage}
          onApply={(croppedImg) => {
            setCropTarget(null)
            if (onUpdateImages) onUpdateImages(croppedImg, undefined)
          }}
          onCancel={() => setCropTarget(null)}
        />
      )}
    </div>
  )
}
