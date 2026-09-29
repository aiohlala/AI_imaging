import { useCallback, useEffect, useRef, useState } from 'react'
import { isAnimatedGif, decodeGif, type GifContext } from '../lib/gifInpaint'

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const ACCEPT_ATTR = 'image/png,image/jpeg,image/webp,image/gif'

interface UploadZoneProps {
  onImageLoaded: (image: HTMLImageElement, fileName?: string, gifContext?: GifContext) => void
}

/** 檢查並載入圖片或動態 GIF 檔案 */
async function loadFile(file: File): Promise<{ image: HTMLImageElement; gifContext?: GifContext }> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error('不支援的檔案格式，請使用 PNG、JPG、WebP 或 GIF 動態圖。')
  }

  const arrayBuffer = await file.arrayBuffer()

  // 1. 若為動態 GIF (幀數 > 1)
  if (isAnimatedGif(arrayBuffer)) {
    const gifContext = decodeGif(arrayBuffer)
    const firstFrameCanvas = gifContext.frames[0].canvas
    const img = new Image()
    img.src = firstFrameCanvas.toDataURL('image/png')
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('GIF 影格解析失敗'))
    })
    return { image: img, gifContext }
  }

  // 2. 常規靜態圖片 (PNG / JPG / WebP / 單幀 GIF)
  const blob = new Blob([arrayBuffer], { type: file.type })
  const url = URL.createObjectURL(blob)
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve()
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('圖片載入失敗，檔案可能已損壞。'))
    }
    img.src = url
  })
  return { image: img }
}

export default function UploadZone({ onImageLoaded }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return
      setError(null)
      setLoading(true)
      try {
        const { image, gifContext } = await loadFile(file)
        onImageLoaded(image, file.name, gifContext)
      } catch (e) {
        setError(e instanceof Error ? e.message : '圖片載入失敗。')
      } finally {
        setLoading(false)
      }
    },
    [onImageLoaded],
  )

  // Ctrl/Cmd + V 貼上圖片
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((it) =>
        it.type.startsWith('image/'),
      )
      if (item) {
        e.preventDefault()
        const file = item.getAsFile()
        void handleFile(file)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [handleFile])

  return (
    <div className="upload-zone-wrapper">
      <div
        className={`upload-zone${dragging ? ' dragging' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => !loading && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void handleFile(e.dataTransfer.files[0])
        }}
      >
        <div className="upload-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
        </div>
        <p className="upload-title">
          {loading ? '正在解析檔案與動態影格…' : '拖曳圖片到這裡，或點擊選擇檔案'}
        </p>
        <p className="upload-hint">
          支援 PNG / JPG / WebP / <span className="highlight-gif">動態 GIF</span>，也可直接 Ctrl / Cmd + V 貼上
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          hidden
          onChange={(e) => {
            void handleFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
