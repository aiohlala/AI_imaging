import { useCallback, useRef, useState } from 'react'
import UploadZone from './components/UploadZone'
import MaskEditor from './components/MaskEditor'
import ResultView from './components/ResultView'
import { inpaint } from './lib/inpaint'

type Status = 'empty' | 'editing' | 'processing' | 'done'

export default function App() {
  const [status, setStatus] = useState<Status>('empty')
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [result, setResult] = useState<{ canvas: HTMLCanvasElement; downscaled: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // mask 畫布由 App 持有（state），切換階段時保留，「繼續編輯」可接著修改
  const [maskCanvas, setMaskCanvas] = useState<HTMLCanvasElement | null>(null)
  // 避免使用者重複點擊造成重複處理
  const processingRef = useRef(false)

  const handleImageLoaded = useCallback((img: HTMLImageElement) => {
    const mask = document.createElement('canvas')
    mask.width = img.naturalWidth
    mask.height = img.naturalHeight
    setMaskCanvas(mask)
    setResult(null)
    setError(null)
    setImage(img)
    setStatus('editing')
  }, [])

  const handleProcess = useCallback(async () => {
    if (!image || !maskCanvas || processingRef.current) return
    processingRef.current = true
    setError(null)
    setStatus('processing')
    try {
      const res = await inpaint(image, maskCanvas)
      setResult(res)
      setStatus('done')
    } catch (e) {
      console.error(e)
      setError('處理失敗，請再試一次或改用較小的圖片。')
      setStatus('editing')
    } finally {
      processingRef.current = false
    }
  }, [image, maskCanvas])

  const handleReset = useCallback(() => {
    setMaskCanvas(null)
    setImage(null)
    setResult(null)
    setError(null)
    setStatus('empty')
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <h1>浮水印去除工具</h1>
        <p className="subtitle">純前端處理，圖片不會上傳到任何伺服器</p>
      </header>

      <main className="app-main">
        {status === 'empty' && <UploadZone onImageLoaded={handleImageLoaded} />}

        {status === 'editing' && image && maskCanvas && (
          <>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <MaskEditor
              image={image}
              maskCanvas={maskCanvas}
              onProcess={handleProcess}
              onBack={handleReset}
            />
          </>
        )}

        {status === 'processing' && (
          <div className="processing">
            <div className="spinner" aria-hidden="true" />
            <p>正在去除浮水印…</p>
            <p className="hint-text">首次使用需載入 OpenCV，請稍候</p>
          </div>
        )}

        {status === 'done' && image && result && (
          <ResultView
            image={image}
            resultCanvas={result.canvas}
            downscaled={result.downscaled}
            onContinueEditing={() => setStatus('editing')}
            onReset={handleReset}
          />
        )}
      </main>

      <footer className="app-footer">
        <p>使用 OpenCV Telea inpainting 演算法，所有運算皆在瀏覽器本機完成。</p>
      </footer>
    </div>
  )
}
