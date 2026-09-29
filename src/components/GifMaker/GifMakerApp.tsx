import { useCallback, useEffect, useRef, useState } from 'react'
import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import omggif from 'omggif'
import {
  generateInterpolatedFrames,
  type KeyframeItem,
  type InterpolatedFrame,
} from '../../lib/frameInterpolation'

const DEMO_PRESETS = [
  {
    title: '🎾 彈跳光球',
    desc: '3 張關鍵影格 ➜ AI 自動補幀成 24 幀流暢拋物線',
    generate: () => {
      const frames: KeyframeItem[] = []
      const w = 320
      const h = 320
      const positions = [
        { x: 50, y: 230, r: 24, col: '#38bdf8' },
        { x: 160, y: 70, r: 26, col: '#818cf8' },
        { x: 270, y: 230, r: 24, col: '#f43f5e' },
      ]
      positions.forEach((pos, idx) => {
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')!
        ctx.fillStyle = '#0b1120'
        ctx.fillRect(0, 0, w, h)

        // Ground track
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(20, 254)
        ctx.lineTo(300, 254)
        ctx.stroke()

        // Ball with glowing gradient
        const grad = ctx.createRadialGradient(pos.x - 6, pos.y - 6, 2, pos.x, pos.y, pos.r)
        grad.addColorStop(0, '#ffffff')
        grad.addColorStop(0.5, pos.col)
        grad.addColorStop(1, '#0b1120')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, pos.r, 0, Math.PI * 2)
        ctx.fill()

        const img = new Image()
        img.src = c.toDataURL('image/png')
        frames.push({
          id: `demo_ball_${idx}`,
          img,
          name: `關鍵動作_${idx + 1}.png`,
          width: w,
          height: h,
        })
      })
      return frames
    },
  },
  {
    title: '😃 表情漸變',
    desc: '3 張微表情關鍵影格 ➜ AI 平滑變臉過渡',
    generate: () => {
      const frames: KeyframeItem[] = []
      const w = 300
      const h = 300
      const moods = [
        { mouthCurve: 10, eyeH: 8, col: '#facc15' },
        { mouthCurve: 0, eyeH: 2, col: '#f59e0b' },
        { mouthCurve: -12, eyeH: 9, col: '#fb7185' },
      ]
      moods.forEach((m, idx) => {
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')!
        ctx.fillStyle = '#0f172a'
        ctx.fillRect(0, 0, w, h)

        // Face
        ctx.fillStyle = m.col
        ctx.beginPath()
        ctx.arc(150, 150, 80, 0, Math.PI * 2)
        ctx.fill()

        // Eyes
        ctx.fillStyle = '#1e293b'
        ctx.beginPath()
        ctx.ellipse(120, 130, 8, m.eyeH, 0, 0, Math.PI * 2)
        ctx.ellipse(180, 130, 8, m.eyeH, 0, 0, Math.PI * 2)
        ctx.fill()

        // Mouth
        ctx.strokeStyle = '#1e293b'
        ctx.lineWidth = 5
        ctx.beginPath()
        ctx.moveTo(115, 180)
        ctx.quadraticCurveTo(150, 180 + m.mouthCurve, 185, 180)
        ctx.stroke()

        const img = new Image()
        img.src = c.toDataURL('image/png')
        frames.push({
          id: `demo_face_${idx}`,
          img,
          name: `表情動作_${idx + 1}.png`,
          width: w,
          height: h,
        })
      })
      return frames
    },
  },
]

export default function GifMakerApp() {
  const [keyframes, setKeyframes] = useState<KeyframeItem[]>([])
  const [fps, setFps] = useState(12) // 1 ~ 30 fps
  const [loopMode, setLoopMode] = useState<'loop' | 'pingpong'>('loop')
  const [isPlaying, setIsPlaying] = useState(true)
  const [currentFrameIdx, setCurrentFrameIdx] = useState(0)

  // AI 補幀狀態
  const [enableInterpolation, setEnableInterpolation] = useState(true)
  const [targetTotalFrames, setTargetTotalFrames] = useState(24) // 預設補齊至 24 幀
  const [interpMode, setInterpMode] = useState<'motion_flow' | 'smooth_blend'>('motion_flow')
  const [isInterpolating, setIsInterpolating] = useState(false)
  const [interpProgress, setInterpProgress] = useState(0)
  const [interpolatedFrames, setInterpolatedFrames] = useState<InterpolatedFrame[]>([])

  // 匯出狀態
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPlayingRef = useRef(isPlaying)
  isPlayingRef.current = isPlaying

  // 當前播放使用的基本影格序列（若有 AI 補幀則使用補幀結果，否則使用原始 Keyframes）
  const activeBaseFrames = (enableInterpolation && interpolatedFrames.length > 0)
    ? interpolatedFrames.map((f) => f.canvas)
    : keyframes.map((k) => {
        const c = document.createElement('canvas')
        c.width = keyframes[0].width || 400
        c.height = keyframes[0].height || 400
        const ctx = c.getContext('2d')!
        ctx.drawImage(k.img, 0, 0, c.width, c.height)
        return c
      })

  // 根據 loop / pingpong 構建播放清單
  const playbackSequence = loopMode === 'pingpong' && activeBaseFrames.length > 2
    ? [...activeBaseFrames, ...activeBaseFrames.slice(1, -1).reverse()]
    : activeBaseFrames

  // 1. 觸發 AI 補幀計算
  const runAiInterpolation = useCallback(async (
    kfs: KeyframeItem[],
    count: number,
    mode: 'motion_flow' | 'smooth_blend',
    isLoop: boolean,
  ) => {
    if (kfs.length < 2) {
      setInterpolatedFrames([])
      return
    }
    setIsInterpolating(true)
    setInterpProgress(0)

    try {
      const width = kfs[0].width || 400
      const height = kfs[0].height || 400
      const delayMs = Math.round(1000 / fps)

      const result = await generateInterpolatedFrames(kfs, {
        targetTotalFrames: count,
        mode,
        loop: isLoop,
        width,
        height,
        frameDelay: delayMs,
        onProgress: (cur, tot) => setInterpProgress(Math.round((cur / tot) * 100)),
      })

      setInterpolatedFrames(result)
      setCurrentFrameIdx(0)
    } catch (e) {
      console.error('AI 補幀失敗', e)
    } finally {
      setIsInterpolating(false)
      setInterpProgress(0)
    }
  }, [fps])

  useEffect(() => {
    if (!enableInterpolation || keyframes.length < 2) {
      setInterpolatedFrames([])
      return
    }
    const timer = setTimeout(() => {
      void runAiInterpolation(keyframes, targetTotalFrames, interpMode, loopMode === 'loop')
    }, 200)
    return () => clearTimeout(timer)
  }, [keyframes, enableInterpolation, targetTotalFrames, interpMode, loopMode, runAiInterpolation])

  // 2. 批次上傳解析
  const handleFiles = async (files: FileList | File[]) => {
    const newKfs: KeyframeItem[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const arrayBuffer = await file.arrayBuffer()

      if (file.type === 'image/gif') {
        try {
          const bytes = new Uint8Array(arrayBuffer)
          const reader = new omggif.GifReader(bytes)
          const num = reader.numFrames()
          const w = reader.width
          const h = reader.height
          const pixelBuf = new Uint8ClampedArray(w * h * 4)

          for (let f = 0; f < num; f++) {
            reader.decodeAndBlitFrameRGBA(f, pixelBuf)
            const c = document.createElement('canvas')
            c.width = w
            c.height = h
            c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixelBuf), w, h), 0, 0)
            const img = new Image()
            img.src = c.toDataURL('image/png')
            await new Promise((r) => { img.onload = r })
            newKfs.push({
              id: `${Date.now()}_${i}_${f}_${Math.random()}`,
              img,
              name: `${file.name.replace(/\.[^.]+$/, '')}_幀${f + 1}`,
              width: w,
              height: h,
            })
          }
          continue
        } catch (e) {
          console.warn('GIF 解析失敗', e)
        }
      }

      const blob = new Blob([arrayBuffer], { type: file.type })
      const url = URL.createObjectURL(blob)
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('圖片載入失敗'))
        img.src = url
      })
      newKfs.push({
        id: `${Date.now()}_${i}_${Math.random()}`,
        img,
        name: file.name,
        width: img.naturalWidth,
        height: img.naturalHeight,
      })
    }

    if (newKfs.length > 0) {
      setKeyframes((prev) => [...prev, ...newKfs])
      setCurrentFrameIdx(0)
    }
  }

  // 3. 畫布即時渲染
  const renderFrameToCanvas = useCallback((canvasEl: HTMLCanvasElement) => {
    const canvas = canvasRef.current
    if (!canvas || !canvasEl) return
    const targetW = canvasEl.width
    const targetH = canvasEl.height

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
    }

    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, targetW, targetH)
    ctx.drawImage(canvasEl, 0, 0, targetW, targetH)
  }, [])

  // 4. 動態播放循環
  useEffect(() => {
    if (!isPlaying || playbackSequence.length === 0) return

    let canceled = false
    let seqIdx = currentFrameIdx
    const delayMs = Math.round(1000 / fps)

    const tick = () => {
      if (canceled || !isPlayingRef.current) return
      seqIdx = (seqIdx + 1) % playbackSequence.length
      setCurrentFrameIdx(seqIdx)
      renderFrameToCanvas(playbackSequence[seqIdx])
      timerRef.current = setTimeout(tick, delayMs)
    }

    renderFrameToCanvas(playbackSequence[currentFrameIdx % playbackSequence.length])
    timerRef.current = setTimeout(tick, delayMs)

    return () => {
      canceled = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [isPlaying, playbackSequence, fps, renderFrameToCanvas, currentFrameIdx])

  const moveFrame = (index: number, direction: 'left' | 'right') => {
    if (direction === 'left' && index === 0) return
    if (direction === 'right' && index === keyframes.length - 1) return
    const targetIdx = direction === 'left' ? index - 1 : index + 1
    const copy = [...keyframes]
    const temp = copy[index]
    copy[index] = copy[targetIdx]
    copy[targetIdx] = temp
    setKeyframes(copy)
  }

  const deleteFrame = (index: number) => {
    setKeyframes((prev) => prev.filter((_, i) => i !== index))
  }

  const handleUseDemo = (demoIdx = 0) => {
    const demo = DEMO_PRESETS[demoIdx].generate()
    setKeyframes(demo)
    setTargetTotalFrames(24)
    setEnableInterpolation(true)
  }

  // 5. 匯出動態 GIF
  const handleExportGif = async () => {
    if (playbackSequence.length === 0) return
    setIsExporting(true)
    setExportProgress(0)

    try {
      const targetW = playbackSequence[0].width || 400
      const targetH = playbackSequence[0].height || 400
      const encoder = GIFEncoder()
      const delayMs = Math.round(1000 / fps)

      for (let s = 0; s < playbackSequence.length; s++) {
        const frameCanvas = playbackSequence[s]
        const ctx = frameCanvas.getContext('2d')!
        const imgData = ctx.getImageData(0, 0, targetW, targetH).data

        const palette = quantize(imgData, 256)
        const index = applyPalette(imgData, palette)
        encoder.writeFrame(index, targetW, targetH, { palette, delay: delayMs })

        setExportProgress(Math.round(((s + 1) / playbackSequence.length) * 100))
        await new Promise((r) => setTimeout(r, 6))
      }

      encoder.finish()
      const bytes = encoder.bytes()
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'image/gif' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const firstBase = keyframes[0]?.name ? keyframes[0].name.replace(/\.[^.]+$/, '') : 'animated'
      a.download = `${firstBase}_ai.gif`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error(e)
      alert('GIF 匯出失敗，請再試一次。')
    } finally {
      setIsExporting(false)
      setExportProgress(0)
    }
  }

  return (
    <div className="gifmaker-container">
      {keyframes.length === 0 ? (
        <div className="gifmaker-empty-dropzone">
          <div
            className="gifmaker-drop-box"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (e.dataTransfer.files.length > 0) void handleFiles(e.dataTransfer.files)
            }}
          >
            <div className="drop-icon">🎞️</div>
            <h3>拖曳多張圖片到這裡，或點擊批次選擇</h3>
            <p className="drop-sub">
              上傳 2 張以上靜態關鍵動作圖，AI 即可自動計算中間運動軌跡並智慧補齊影格！
            </p>
            <div className="demo-actions">
              <button
                type="button"
                className="btn-demo-preset"
                onClick={(e) => {
                  e.stopPropagation()
                  handleUseDemo(0)
                }}
              >
                ✨ 載入「彈跳光球」示範 (3 幀 ➜ AI 補幀 24 幀)
              </button>
              <button
                type="button"
                className="btn-demo-preset"
                style={{ marginLeft: 8 }}
                onClick={(e) => {
                  e.stopPropagation()
                  handleUseDemo(1)
                }}
              >
                😃 載入「表情漸變」示範 (3 幀 ➜ AI 補幀 24 幀)
              </button>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                void handleFiles(e.target.files)
                e.target.value = ''
              }
            }}
          />
        </div>
      ) : (
        <div className="gifmaker-workspace">
          {/* 上半部：畫布預覽與播放控制 */}
          <div className="gifmaker-preview-section">
            <div className="gifmaker-status-header">
              {enableInterpolation && interpolatedFrames.length > 0 ? (
                <span className="interpolated-badge">
                  ✨ AI 補幀生效中：原 {keyframes.length} 關鍵幀 ➜ 補齊至 {interpolatedFrames.length} 幀 ({interpMode === 'motion_flow' ? '運動光流模式' : '平滑漸變模式'})
                </span>
              ) : (
                <span className="raw-badge">
                  🎞️ 原始序列模式 ({keyframes.length} 幀)
                </span>
              )}

              {isInterpolating && (
                <span className="computing-badge">
                  AI 正在計算中間運動軌跡 ({interpProgress}%)...
                </span>
              )}
            </div>

            <div className="gifmaker-canvas-wrap">
              <canvas ref={canvasRef} className="gifmaker-preview-canvas" />
            </div>

            <div className="gifmaker-playback-controls">
              <button
                type="button"
                className="btn-play-pause"
                onClick={() => setIsPlaying(!isPlaying)}
              >
                {isPlaying ? '⏸ 暫停' : '▶ 播放'}
              </button>

              <div className="control-slider-group">
                <span className="slider-label">播放速率:</span>
                <input
                  type="range"
                  min={1}
                  max={30}
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value))}
                />
                <span className="slider-val">{fps} FPS ({Math.round(1000 / fps)}ms)</span>
              </div>

              <div className="mode-toggle-group">
                <button
                  type="button"
                  className={`btn-mode-pill${loopMode === 'loop' ? ' active' : ''}`}
                  onClick={() => setLoopMode('loop')}
                >
                  🔄 順序循環
                </button>
                <button
                  type="button"
                  className={`btn-mode-pill${loopMode === 'pingpong' ? ' active' : ''}`}
                  onClick={() => setLoopMode('pingpong')}
                >
                  🪀 來回溜溜球
                </button>
              </div>

              <div className="scrub-indicator">
                目前影格: {currentFrameIdx + 1} / {playbackSequence.length}
              </div>
            </div>
          </div>

          {/* 中間：🤖 AI 平滑補幀設定面板 */}
          <div className="gifmaker-ai-panel">
            <div className="ai-panel-header">
              <div className="ai-toggle-title">
                <label className="switch-label">
                  <input
                    type="checkbox"
                    checked={enableInterpolation}
                    onChange={(e) => setEnableInterpolation(e.target.checked)}
                  />
                  <span className="switch-text">✨ 啟用 AI 動態平滑補幀 (Motion Interpolation)</span>
                </label>
              </div>
              <span className="ai-desc">在關鍵圖片之間自動計算運動向量場，生成自然流暢的連續動態</span>
            </div>

            {enableInterpolation && (
              <div className="ai-controls-row">
                <div className="ai-param-item">
                  <span className="param-name">目標總影格數:</span>
                  <input
                    type="range"
                    min={keyframes.length * 2}
                    max={Math.min(60, keyframes.length * 12)}
                    step={1}
                    value={targetTotalFrames}
                    onChange={(e) => setTargetTotalFrames(Number(e.target.value))}
                  />
                  <span className="param-value">{targetTotalFrames} 幀</span>
                </div>

                <div className="ai-param-item">
                  <span className="param-name">演算法:</span>
                  <div className="mode-toggle-group">
                    <button
                      type="button"
                      className={`btn-mode-pill${interpMode === 'motion_flow' ? ' active' : ''}`}
                      onClick={() => setInterpMode('motion_flow')}
                      title="區塊運動向量補償"
                    >
                      🌪️ 運動光流 (Flow)
                    </button>
                    <button
                      type="button"
                      className={`btn-mode-pill${interpMode === 'smooth_blend' ? ' active' : ''}`}
                      onClick={() => setInterpMode('smooth_blend')}
                      title="平滑餘弦漸變融合"
                    >
                      🌊 平滑漸變 (Blend)
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 下半部：關鍵影格序列 (Keyframes Track) */}
          <div className="gifmaker-timeline-section">
            <div className="timeline-header">
              <div className="timeline-title-row">
                <h4>原始關鍵影格序列 ({keyframes.length} 幀)</h4>
                <span className="timeline-hint">點擊 ◀ ▶ 調整先後順序，AI 會自動重新計算過渡影格</span>
              </div>
              <div className="timeline-actions">
                <button
                  type="button"
                  className="btn-add-more"
                  onClick={() => fileInputRef.current?.click()}
                >
                  ➕ 新增圖片
                </button>
                <button
                  type="button"
                  className="btn-clear-all"
                  onClick={() => setKeyframes([])}
                >
                  ✕ 全部清空
                </button>
              </div>
            </div>

            <div className="timeline-frames-track">
              {keyframes.map((f, idx) => (
                <div key={f.id} className="timeline-frame-card keyframe">
                  <div className="frame-badge">Key #{idx + 1}</div>
                  <img src={f.img.src} alt={f.name} className="frame-thumb" />
                  <div className="frame-actions">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveFrame(idx, 'left')}
                      title="往前移"
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      className="btn-del-frame"
                      onClick={() => deleteFrame(idx)}
                      title="刪除"
                    >
                      ✕
                    </button>
                    <button
                      type="button"
                      disabled={idx === keyframes.length - 1}
                      onClick={() => moveFrame(idx, 'right')}
                      title="往後移"
                    >
                      ▶
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  void handleFiles(e.target.files)
                  e.target.value = ''
                }
              }}
            />

            {/* 底部匯出列 */}
            <div className="gifmaker-export-bar">
              <button
                type="button"
                className="btn-export-gif"
                disabled={isExporting || isInterpolating}
                onClick={handleExportGif}
              >
                {isExporting ? `正在編碼匯出 (${exportProgress}%)...` : '💾 匯出並下載 AI 動態 GIF'}
              </button>
              <span className="privacy-pill">
                🔒 100% 瀏覽器本機記憶體運算 • 零伺服器傳輸 • 隱私極致保證
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
