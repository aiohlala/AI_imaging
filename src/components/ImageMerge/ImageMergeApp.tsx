import { useState } from 'react'
import DualUploadZone from './DualUploadZone'
import SeamlessMerger from './SeamlessMerger'
import AiHeadBodyFusion from './AiHeadBodyFusion'

type Mode = 'seamless' | 'ai-fusion'

function getBaseName(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '') || 'image'
}

export default function ImageMergeApp() {
  const [imageA, setImageA] = useState<{ img: HTMLImageElement; name: string } | null>(null)
  const [imageB, setImageB] = useState<{ img: HTMLImageElement; name: string } | null>(null)
  const [mode, setMode] = useState<Mode>('seamless')
  const [exportCanvas, setExportCanvas] = useState<HTMLCanvasElement | null>(null)

  const handleImagesReady = (
    imgA: HTMLImageElement,
    nameA: string,
    imgB: HTMLImageElement,
    nameB: string,
  ) => {
    setImageA({ img: imgA, name: nameA })
    setImageB({ img: imgB, name: nameB })
  }

  const handleSwap = () => {
    const temp = imageA
    setImageA(imageB)
    setImageB(temp)
  }

  const handleReset = () => {
    setImageA(null)
    setImageB(null)
    setExportCanvas(null)
  }

  const handleDownload = () => {
    if (!exportCanvas) return
    exportCanvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const nameA = imageA ? getBaseName(imageA.name) : 'imageA'
      const nameB = imageB ? getBaseName(imageB.name) : 'imageB'
      a.download = `${nameA}_${nameB}_merge.png`
      a.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  const isLoaded = Boolean(imageA && imageB)

  return (
    <div className="image-merge-app">
      {!isLoaded && <DualUploadZone onImagesReady={handleImagesReady} />}

      {isLoaded && imageA && imageB && (
        <div className="merge-workspace">
          {/* 模式切換列 */}
          <div className="mode-selection-bar">
            <div className="direction-tabs">
              <button
                type="button"
                className={`direction-btn${mode === 'seamless' ? ' active' : ''}`}
                onClick={() => setMode('seamless')}
              >
                <span className="dir-icon">📐</span>
                <span>無縫分割拼接</span>
              </button>
              <button
                type="button"
                className={`direction-btn${mode === 'ai-fusion' ? ' active' : ''}`}
                onClick={() => setMode('ai-fusion')}
              >
                <span className="dir-icon">✨</span>
                <span>AI 人像頭身接合</span>
              </button>
            </div>

            <div className="quick-swap-wrap">
              <button
                type="button"
                className="tool-btn"
                onClick={handleSwap}
                title="快速對調圖 A 與圖 B"
              >
                ⇄ 對調圖 A / 圖 B
              </button>
            </div>
          </div>

          {/* 渲染選定模式之畫布工作區 */}
          {mode === 'seamless' && (
            <SeamlessMerger
              imageA={imageA.img}
              imageB={imageB.img}
              onExportReady={setExportCanvas}
            />
          )}

          {mode === 'ai-fusion' && (
            <AiHeadBodyFusion
              imageA={imageA.img}
              imageB={imageB.img}
              onExportReady={setExportCanvas}
            />
          )}

          {/* 底部操作列 */}
          <div className="action-bar">
            <button type="button" className="secondary" onClick={handleReset}>
              換一張圖片
            </button>
            <button
              type="button"
              className="primary merge-primary-btn"
              onClick={handleDownload}
              disabled={!exportCanvas}
            >
              下載合併成果 ({getBaseName(imageA.name)}_{getBaseName(imageB.name)}_merge.png)
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
