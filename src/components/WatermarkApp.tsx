import { useCallback, useRef, useState } from 'react'
import UploadZone from './UploadZone'
import MaskEditor from './MaskEditor'
import ResultView from './ResultView'
import { inpaint } from '../lib/inpaint'
import { inpaintGif, type GifContext, type GifFrame } from '../lib/gifInpaint'

type Status = 'empty' | 'editing' | 'processing' | 'done'

export default function WatermarkApp() {
  const [status, setStatus] = useState<Status>('empty')
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [fileName, setFileName] = useState('image')
  const [gifContext, setGifContext] = useState<GifContext | null>(null)
  const [result, setResult] = useState<{
    canvas: HTMLCanvasElement
    downscaled: boolean
    cleanFrames?: GifFrame[]
    gifBlob?: Blob
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [maskCanvas, setMaskCanvas] = useState<HTMLCanvasElement | null>(null)
  const [gifProgress, setGifProgress] = useState<{ current: number; total: number } | null>(null)
  const processingRef = useRef(false)

  const handleImageLoaded = useCallback((img: HTMLImageElement, name?: string, gifCtx?: GifContext) => {
    const mask = document.createElement('canvas')
    mask.width = img.naturalWidth
    mask.height = img.naturalHeight
    setMaskCanvas(mask)
    setResult(null)
    setError(null)
    setImage(img)
    setFileName(name || 'image')
    setGifContext(gifCtx ?? null)
    setStatus('editing')
  }, [])

  const handleCrop = useCallback((croppedImage: HTMLImageElement, croppedMask?: HTMLCanvasElement) => {
    setImage(croppedImage)
    // 裁切靜態畫面後暫時清除 gifContext
    setGifContext(null)
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
      if (gifContext && gifContext.frames.length > 1) {
        // GIF 逐幀 ROI Inpainting 流程
        setGifProgress({ current: 1, total: gifContext.frames.length })
        const gifRes = await inpaintGif(
          gifContext.frames,
          maskCanvas,
          (cur, total) => setGifProgress({ current: cur, total }),
        )
        setResult({
          canvas: gifRes.canvas,
          cleanFrames: gifRes.cleanFrames,
          gifBlob: gifRes.gifBlob,
          downscaled: gifRes.downscaled,
        })
      } else {
        // 常規靜態圖片 Inpaint 流程
        const res = await inpaint(image, maskCanvas)
        setResult(res)
      }
      setStatus('done')
    } catch (e) {
      console.error(e)
      setError('處理失敗，請再試一次或改用較小的圖片。')
      setStatus('editing')
    } finally {
      processingRef.current = false
      setGifProgress(null)
    }
  }, [image, maskCanvas, gifContext])

  const handleReset = useCallback(() => {
    setMaskCanvas(null)
    setImage(null)
    setGifContext(null)
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
          {gifContext && (
            <div className="gif-badge-tip">
              🎞️ 已偵測為動態 GIF ({gifContext.frames.length} 幀) • 塗抹浮水印位置後將自動逐幀消除並輸出為動態 GIF
            </div>
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
          {gifProgress ? (
            <>
              <p>正在逐幀去除動態 GIF 浮水印…</p>
              <div className="gif-progress-bar-wrap">
                <div
                  className="gif-progress-bar-fill"
                  style={{ width: `${Math.round((gifProgress.current / gifProgress.total) * 100)}%` }}
                />
              </div>
              <p className="gif-progress-counter">
                第 {gifProgress.current} / {gifProgress.total} 幀 ({Math.round((gifProgress.current / gifProgress.total) * 100)}%)
              </p>
              <p className="hint-text">採用極速 ROI 局部區域 Inpainting，快如閃電</p>
            </>
          ) : (
            <>
              <p>正在去除浮水印…</p>
              <p className="hint-text">首次使用需載入 OpenCV，請稍候</p>
            </>
          )}
        </div>
      )}

      {status === 'done' && image && result && (
        <ResultView
          image={image}
          fileName={fileName}
          resultCanvas={result.canvas}
          downscaled={result.downscaled}
          gifContext={gifContext}
          gifResult={result.cleanFrames && result.gifBlob ? { cleanFrames: result.cleanFrames, gifBlob: result.gifBlob } : null}
          onContinueEditing={() => setStatus('editing')}
          onReset={handleReset}
        />
      )}
    </div>
  )
}
