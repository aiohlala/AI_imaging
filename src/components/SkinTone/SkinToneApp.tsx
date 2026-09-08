import { useCallback, useRef, useState } from 'react'
import UploadZone from '../UploadZone'
import SkinToneEditor from './SkinToneEditor'
import SkinToneResult from './SkinToneResult'
import {
  harmonizeSkinTone,
  type HarmonizeOptions,
  type LabStats,
} from '../../lib/colorTransfer'

type Status = 'empty' | 'editing' | 'processing' | 'done'

export default function SkinToneApp() {
  const [status, setStatus] = useState<Status>('empty')
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [resultCanvas, setResultCanvas] = useState<HTMLCanvasElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [maskCanvas, setMaskCanvas] = useState<HTMLCanvasElement | null>(null)
  const processingRef = useRef(false)

  const handleImageLoaded = useCallback((img: HTMLImageElement) => {
    const mask = document.createElement('canvas')
    mask.width = img.naturalWidth
    mask.height = img.naturalHeight
    setMaskCanvas(mask)
    setResultCanvas(null)
    setError(null)
    setImage(img)
    setStatus('editing')
  }, [])

  const handleProcess = useCallback(
    async (config: { refStats: LabStats; options: HarmonizeOptions }) => {
      if (!image || !maskCanvas || processingRef.current) return
      processingRef.current = true
      setError(null)
      setStatus('processing')

      // 使用 setTimeout 讓 UI 先渲染出 Spinner
      setTimeout(() => {
        try {
          const srcCanvas = document.createElement('canvas')
          srcCanvas.width = image.naturalWidth
          srcCanvas.height = image.naturalHeight
          const ctx = srcCanvas.getContext('2d')!
          ctx.drawImage(image, 0, 0)

          const resCanvas = harmonizeSkinTone(
            srcCanvas,
            maskCanvas,
            config.refStats,
            config.options,
          )

          setResultCanvas(resCanvas)
          setStatus('done')
        } catch (e) {
          console.error(e)
          setError('膚色調和處理失敗，請稍後重試。')
          setStatus('editing')
        } finally {
          processingRef.current = false
        }
      }, 50)
    },
    [image, maskCanvas],
  )

  const handleReset = useCallback(() => {
    setMaskCanvas(null)
    setImage(null)
    setResultCanvas(null)
    setError(null)
    setStatus('empty')
  }, [])

  return (
    <div className="skintone-app">
      {status === 'empty' && (
        <div className="skintone-intro-wrapper">
          <div className="feature-badge">🎨 人像肌膚自然調和</div>
          <p className="intro-text">
            精準抓取身體或臉部膚色，透過 OKLab 感官色彩轉移演算法進行調和。
            <br />
            保持原有立體骨骼光影與肌膚毛孔細節，讓臉部與身體膚色自然勻稱！
          </p>
          <UploadZone onImageLoaded={handleImageLoaded} />
        </div>
      )}

      {status === 'editing' && image && maskCanvas && (
        <>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <SkinToneEditor
            image={image}
            maskCanvas={maskCanvas}
            onProcess={handleProcess}
            onBack={handleReset}
          />
        </>
      )}

      {status === 'processing' && (
        <div className="processing">
          <div className="spinner skin-spinner" aria-hidden="true" />
          <p>正在分析與調和膚色…</p>
          <p className="hint-text">正在進行 OKLab 色彩轉移與邊緣高斯羽化運算</p>
        </div>
      )}

      {status === 'done' && image && resultCanvas && (
        <SkinToneResult
          image={image}
          resultCanvas={resultCanvas}
          onContinueEditing={() => setStatus('editing')}
          onReset={handleReset}
        />
      )}
    </div>
  )
}
