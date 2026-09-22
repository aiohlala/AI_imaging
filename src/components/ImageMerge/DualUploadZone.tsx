import { useCallback, useRef, useState } from 'react'

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const ACCEPT_ATTR = 'image/png,image/jpeg,image/webp'

interface DualUploadZoneProps {
  onImagesReady: (
    imageA: HTMLImageElement,
    nameA: string,
    imageB: HTMLImageElement,
    nameB: string,
  ) => void
}

function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      reject(new Error('不支援的格式，請使用 PNG、JPG 或 WebP。'))
      return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve(img)
    }
    img.onerror = () => {
      reject(new Error('圖片載入失敗。'))
    }
    img.src = url
  })
}

export default function DualUploadZone({ onImagesReady }: DualUploadZoneProps) {
  const [imgA, setImgA] = useState<{ img: HTMLImageElement; name: string } | null>(null)
  const [imgB, setImgB] = useState<{ img: HTMLImageElement; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragA, setDragA] = useState(false)
  const [dragB, setDragB] = useState(false)

  const inputRefA = useRef<HTMLInputElement>(null)
  const inputRefB = useRef<HTMLInputElement>(null)

  const handleFileA = useCallback(async (file: File | undefined | null) => {
    if (!file) return
    setError(null)
    try {
      const img = await loadImageFile(file)
      setImgA({ img, name: file.name || 'imageA' })
    } catch (e) {
      setError(e instanceof Error ? e.message : '圖片 A 載入失敗。')
    }
  }, [])

  const handleFileB = useCallback(async (file: File | undefined | null) => {
    if (!file) return
    setError(null)
    try {
      const img = await loadImageFile(file)
      setImgB({ img, name: file.name || 'imageB' })
    } catch (e) {
      setError(e instanceof Error ? e.message : '圖片 B 載入失敗。')
    }
  }, [])

  const handleSwap = () => {
    const temp = imgA
    setImgA(imgB)
    setImgB(temp)
  }

  const handleStartMerge = () => {
    if (!imgA || !imgB) return
    onImagesReady(imgA.img, imgA.name, imgB.img, imgB.name)
  }

  return (
    <div className="dual-upload-wrapper">
      <div className="feature-badge">🧩 影像無縫合併 & AI 接合</div>
      <p className="intro-text">
        支援兩張圖片無縫拼接（左右/上下自選比例、獨立縮放對位）與 AI 頭部/身體智慧接合融合。
      </p>

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      <div className="dual-cards-container">
        {/* 卡片 A */}
        <div
          className={`dual-upload-card${dragA ? ' dragging' : ''}${imgA ? ' loaded' : ''}`}
          onClick={() => !imgA && inputRefA.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragA(true)
          }}
          onDragLeave={() => setDragA(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragA(false)
            void handleFileA(e.dataTransfer.files[0])
          }}
        >
          <div className="card-badge">圖片 A</div>
          <span className="card-role-hint">左圖 / 上圖 / 人像頭部</span>

          {imgA ? (
            <div className="card-preview">
              <img src={imgA.img.src} alt="圖 A 預覽" className="thumbnail-img" />
              <div className="card-info">
                <span className="file-name">{imgA.name}</span>
                <span className="file-size">
                  {imgA.img.naturalWidth} × {imgA.img.naturalHeight} px
                </span>
              </div>
              <button
                type="button"
                className="card-remove-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  setImgA(null)
                }}
              >
                ✕ 更換
              </button>
            </div>
          ) : (
            <div className="card-empty">
              <span className="upload-emoji">🖼️</span>
              <p className="upload-tip">點擊或拖曳上傳圖片 A</p>
            </div>
          )}

          <input
            ref={inputRefA}
            type="file"
            accept={ACCEPT_ATTR}
            hidden
            onChange={(e) => {
              void handleFileA(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>

        {/* 中間對調按鈕 */}
        <div className="dual-swap-divider">
          <button
            type="button"
            className="swap-circle-btn"
            onClick={handleSwap}
            disabled={!imgA && !imgB}
            title="對調圖 A 與圖 B"
          >
            ⇄
          </button>
          <span className="swap-hint">對調位置</span>
        </div>

        {/* 卡片 B */}
        <div
          className={`dual-upload-card${dragB ? ' dragging' : ''}${imgB ? ' loaded' : ''}`}
          onClick={() => !imgB && inputRefB.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragB(true)
          }}
          onDragLeave={() => setDragB(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragB(false)
            void handleFileB(e.dataTransfer.files[0])
          }}
        >
          <div className="card-badge">圖片 B</div>
          <span className="card-role-hint">右圖 / 下圖 / 人體身型</span>

          {imgB ? (
            <div className="card-preview">
              <img src={imgB.img.src} alt="圖 B 預覽" className="thumbnail-img" />
              <div className="card-info">
                <span className="file-name">{imgB.name}</span>
                <span className="file-size">
                  {imgB.img.naturalWidth} × {imgB.img.naturalHeight} px
                </span>
              </div>
              <button
                type="button"
                className="card-remove-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  setImgB(null)
                }}
              >
                ✕ 更換
              </button>
            </div>
          ) : (
            <div className="card-empty">
              <span className="upload-emoji">🖼️</span>
              <p className="upload-tip">點擊或拖曳上傳圖片 B</p>
            </div>
          )}

          <input
            ref={inputRefB}
            type="file"
            accept={ACCEPT_ATTR}
            hidden
            onChange={(e) => {
              void handleFileB(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
      </div>

      <div className="dual-actions">
        <button
          type="button"
          className="primary merge-launch-btn"
          disabled={!imgA || !imgB}
          onClick={handleStartMerge}
        >
          🧩 開始合併兩張圖片
        </button>
      </div>
    </div>
  )
}
