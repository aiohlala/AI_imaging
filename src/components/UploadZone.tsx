import { useCallback, useEffect, useRef, useState } from 'react'

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const ACCEPT_ATTR = 'image/png,image/jpeg,image/webp'

interface UploadZoneProps {
  onImageLoaded: (image: HTMLImageElement, fileName?: string) => void
}

/** 檢查並載入圖片檔案，成功時回呼，失敗時拋出錯誤訊息 */
function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      reject(new Error('不支援的檔案格式，請使用 PNG、JPG 或 WebP 圖片。'))
      return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('圖片載入失敗，檔案可能已損壞。'))
    }
    img.src = url
  })
}

export default function UploadZone({ onImageLoaded }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return
      setError(null)
      try {
        const img = await loadImageFile(file)
        onImageLoaded(img, file.name)
      } catch (e) {
        setError(e instanceof Error ? e.message : '圖片載入失敗。')
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
        onClick={() => inputRef.current?.click()}
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
        <p className="upload-title">拖曳圖片到這裡，或點擊選擇檔案</p>
        <p className="upload-hint">
          支援 PNG / JPG / WebP，也可以直接 Ctrl / Cmd + V 貼上圖片
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
