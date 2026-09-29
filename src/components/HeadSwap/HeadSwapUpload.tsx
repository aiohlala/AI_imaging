import { useCallback, useRef, useState } from 'react'
import { HEAD_PRESETS, TARGET_PRESETS, type PresetItem } from './examplePresets'

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const ACCEPT_ATTR = 'image/png,image/jpeg,image/webp,image/gif'

interface HeadSwapUploadProps {
  onImagesReady: (
    headImg: HTMLImageElement,
    headName: string,
    targetImg: HTMLImageElement,
    targetName: string,
  ) => void
}

function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      reject(new Error('不支援的格式，請使用 PNG、JPG、WebP 或 GIF。'))
      return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('圖片載入失敗。'))
    img.src = url
  })
}

function loadDataUrlImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('範例圖載入失敗。'))
    img.src = dataUrl
  })
}

export default function HeadSwapUpload({ onImagesReady }: HeadSwapUploadProps) {
  const [head, setHead] = useState<{ img: HTMLImageElement; name: string } | null>(null)
  const [target, setTarget] = useState<{ img: HTMLImageElement; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragHead, setDragHead] = useState(false)
  const [dragTarget, setDragTarget] = useState(false)

  const inputRefHead = useRef<HTMLInputElement>(null)
  const inputRefTarget = useRef<HTMLInputElement>(null)

  const handleHeadFile = useCallback(async (file: File | undefined | null) => {
    if (!file) return
    setError(null)
    try {
      const img = await loadImageFile(file)
      setHead({ img, name: file.name || 'head_image' })
    } catch (e) {
      setError(e instanceof Error ? e.message : '頭像來源載入失敗。')
    }
  }, [])

  const handleTargetFile = useCallback(async (file: File | undefined | null) => {
    if (!file) return
    setError(null)
    try {
      const img = await loadImageFile(file)
      setTarget({ img, name: file.name || 'target_image' })
    } catch (e) {
      setError(e instanceof Error ? e.message : '目標身型載入失敗。')
    }
  }, [])

  const handleSelectHeadPreset = async (preset: PresetItem) => {
    setError(null)
    try {
      const img = await loadDataUrlImage(preset.thumbDataUrl)
      setHead({ img, name: preset.name })
    } catch (e) {
      setError(e instanceof Error ? e.message : '範例頭像載入失敗。')
    }
  }

  const handleSelectTargetPreset = async (preset: PresetItem) => {
    setError(null)
    try {
      const img = await loadDataUrlImage(preset.thumbDataUrl)
      setTarget({ img, name: preset.name })
    } catch (e) {
      setError(e instanceof Error ? e.message : '範例底圖載入失敗。')
    }
  }

  const handleSwap = () => {
    const temp = head
    setHead(target)
    setTarget(temp)
  }

  const handleGenerate = () => {
    if (!head || !target) return
    onImagesReady(head.img, head.name, target.img, target.name)
  }

  return (
    <div className="headswap-upload-wrapper">
      <div className="feature-badge">🔄 AI 自動換頭 (Head Swap)</div>
      <p className="intro-text">
        上傳頭像與目標底圖，MediaPipe 自動定位身型、摳出頭像並等比貼合，結合 OKLab 感官色彩調和光影。
      </p>

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      <div className="headswap-cards-grid">
        {/* 卡片 A: 頭部來源圖 */}
        <div className="headswap-card-box">
          <div className="headswap-card-header">
            <span className="card-badge">頭像來源 A</span>
            <span className="card-hint">建議正面清晰、單人人臉</span>
          </div>

          <div
            className={`headswap-dropzone${dragHead ? ' dragging' : ''}${head ? ' loaded' : ''}`}
            onClick={() => !head && inputRefHead.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragHead(true)
            }}
            onDragLeave={() => setDragHead(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragHead(false)
              void handleHeadFile(e.dataTransfer.files[0])
            }}
          >
            {head ? (
              <div className="card-preview">
                <img src={head.img.src} alt="頭部預覽" className="thumbnail-img" />
                <div className="card-info">
                  <span className="file-name">{head.name}</span>
                  <span className="file-size">
                    {head.img.naturalWidth} × {head.img.naturalHeight} px
                  </span>
                </div>
                <button
                  type="button"
                  className="card-remove-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    setHead(null)
                  }}
                >
                  ✕ 更換
                </button>
              </div>
            ) : (
              <div className="card-empty">
                <span className="upload-emoji">👤</span>
                <p className="upload-title">點擊或拖曳上傳頭像</p>
                <p className="upload-sub">支援 PNG、JPG、WebP</p>
              </div>
            )}

            <input
              ref={inputRefHead}
              type="file"
              accept={ACCEPT_ATTR}
              hidden
              onChange={(e) => {
                void handleHeadFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>

          {/* 範例頭像列表 */}
          <div className="presets-row">
            <span className="presets-label">範例 Example:</span>
            <div className="presets-items">
              {HEAD_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="preset-btn"
                  onClick={() => void handleSelectHeadPreset(p)}
                  title={`使用示範：${p.name}`}
                >
                  <img src={p.thumbDataUrl} alt={p.name} className="preset-thumb" />
                  <span className="preset-name">{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 中間對調按鈕 */}
        <div className="headswap-swap-col">
          <button
            type="button"
            className="swap-circle-btn"
            onClick={handleSwap}
            disabled={!head && !target}
            title="對調頭像與身型"
          >
            ⇄
          </button>
          <span className="swap-hint">對調角色</span>
        </div>

        {/* 卡片 B: 目標底圖 / 身型 */}
        <div className="headswap-card-box">
          <div className="headswap-card-header">
            <span className="card-badge target">目標身型 B</span>
            <span className="card-hint">單人半身或全身照、GIF動圖</span>
          </div>

          <div
            className={`headswap-dropzone${dragTarget ? ' dragging' : ''}${target ? ' loaded' : ''}`}
            onClick={() => !target && inputRefTarget.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragTarget(true)
            }}
            onDragLeave={() => setDragTarget(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragTarget(false)
              void handleTargetFile(e.dataTransfer.files[0])
            }}
          >
            {target ? (
              <div className="card-preview">
                <img src={target.img.src} alt="身型預覽" className="thumbnail-img" />
                <div className="card-info">
                  <span className="file-name">{target.name}</span>
                  <span className="file-size">
                    {target.img.naturalWidth} × {target.img.naturalHeight} px
                  </span>
                </div>
                <button
                  type="button"
                  className="card-remove-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    setTarget(null)
                  }}
                >
                  ✕ 更換
                </button>
              </div>
            ) : (
              <div className="card-empty">
                <span className="upload-emoji">🧍</span>
                <p className="upload-title">點擊或拖曳上傳身型底圖</p>
                <p className="upload-sub">支援 PNG、JPG、WebP、GIF</p>
              </div>
            )}

            <input
              ref={inputRefTarget}
              type="file"
              accept={ACCEPT_ATTR}
              hidden
              onChange={(e) => {
                void handleTargetFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>

          {/* 範例目標底圖列表 */}
          <div className="presets-row">
            <span className="presets-label">範例 Example:</span>
            <div className="presets-items">
              {TARGET_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="preset-btn"
                  onClick={() => void handleSelectTargetPreset(p)}
                  title={`使用示範：${p.name}`}
                >
                  <img src={p.thumbDataUrl} alt={p.name} className="preset-thumb" />
                  <span className="preset-name">{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="headswap-action-footer">
        <button
          type="button"
          className="headswap-generate-btn"
          disabled={!head || !target}
          onClick={handleGenerate}
        >
          ✨ 開始一鍵自動換頭 (Generate Head Swap)
        </button>
        <p className="privacy-guarantee-hint">
          🔒 100% 瀏覽器本機記憶體運算 • 無歷史儲存 • 關閉或重新整理分頁資料即刻清空
        </p>
      </div>
    </div>
  )
}
