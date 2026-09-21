import { useCallback, useRef, useState } from 'react'
import UploadZone from './UploadZone'
import MaskEditor from './MaskEditor'
import ResultView from './ResultView'
import { inpaint } from '../lib/inpaint'

type Status = 'empty' | 'editing' | 'processing' | 'done'

export default function WatermarkApp() {
  const [status, setStatus] = useState<Status>('empty')
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [fileName, setFileName] = useState('image')
  const [result, setResult] = useState<{ canvas: HTMLCanvasElement; downscaled: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [maskCanvas, setMaskCanvas] = useState<HTMLCanvasElement | null>(null)
  const processingRef = useRef(false)

  const handleImageLoaded = useCallback((img: HTMLImageElement, name?: string) => {
    const mask = document.createElement('canvas')
    mask.width = img.naturalWidth
    mask.height = img.naturalHeight
    setMaskCanvas(mask)
    setResult(null)
    setError(null)
    setImage(img)
    setFileName(name || 'image')
    setStatus('editing')
  }, [])

  const handleCrop = useCallback((croppedImage: HTMLImageElement, croppedMask?: HTMLCanvasElement) => {
    setImage(croppedImage)
    if (croppedMask) {
      setMaskCanvas(croppedMask)
    } else {
      const mask = document.createElement('canvas')
      mask.width = croppedImage.naturalWidth
      mask.height = croppedImage.naturalHeight
      setMaskCanvas(mask)
    }
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
    <div className="watermark-app">
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
            onCrop={handleCrop}
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
          fileName={fileName}
          resultCanvas={result.canvas}
          downscaled={result.downscaled}
          onContinueEditing={() => setStatus('editing')}
          onReset={handleReset}
        />
      )}
    </div>
  )
}
