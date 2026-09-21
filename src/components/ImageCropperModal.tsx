import { useCallback, useEffect, useRef, useState } from 'react'

type AspectRatio = 'free' | '1:1' | '4:3' | '3:4' | '16:9'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface ImageCropperModalProps {
  image: HTMLImageElement
  maskCanvas?: HTMLCanvasElement | null
  onApply: (croppedImage: HTMLImageElement, croppedMask?: HTMLCanvasElement) => void
  onCancel: () => void
}

type DragType =
  | 'move'
  | 'create'
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'

export default function ImageCropperModal({
  image,
  maskCanvas,
  onApply,
  onCancel,
}: ImageCropperModalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null)
  const imgW = image.naturalWidth
  const imgH = image.naturalHeight

  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('free')
  // 裁切區塊（以原圖真實像素為單位）
  const [crop, setCrop] = useState<Rect>(() => {
    // 預設選取中央 80% 區域
    const w = Math.round(imgW * 0.8)
    const h = Math.round(imgH * 0.8)
    const x = Math.round((imgW - w) / 2)
    const y = Math.round((imgH - h) / 2)
    return { x, y, w, h }
  })

  // 容器內部圖片顯示區域（用於座標換算）
  const [imgDisplay, setImgDisplay] = useState<{ x: number; y: number; w: number; h: number }>({
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  })

  const dragRef = useRef<{
    type: DragType
    startX: number
    startY: number
    startCrop: Rect
  } | null>(null)

  // 計算圖片在容器中的縮放尺寸
  const updateLayout = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const cw = container.clientWidth
    const ch = container.clientHeight
    if (cw <= 0 || ch <= 0) return

    const scale = Math.min((cw - 40) / imgW, (ch - 40) / imgH)
    const w = Math.round(imgW * scale)
    const h = Math.round(imgH * scale)
    const x = Math.round((cw - w) / 2)
    const y = Math.round((ch - h) / 2)
    setImgDisplay({ x, y, w, h })
  }, [imgW, imgH])


  // 將原圖繪製到畫布上（直接 drawImage，不受 blob URL 影響，保證即時清晰可見）
  useEffect(() => {
    const canvas = sourceCanvasRef.current
    if (!canvas || imgDisplay.w === 0 || imgDisplay.h === 0) return
    canvas.width = imgDisplay.w
    canvas.height = imgDisplay.h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, imgDisplay.w, imgDisplay.h)
  }, [image, imgDisplay])

  useEffect(() => {
    updateLayout()
    const observer = new ResizeObserver(updateLayout)
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [updateLayout])

  // 切換比例時自動調整選取框
  const applyAspectRatio = (ratio: AspectRatio) => {
    setAspectRatio(ratio)
    if (ratio === 'free') return

    let targetRatio = 1
    if (ratio === '1:1') targetRatio = 1
    else if (ratio === '4:3') targetRatio = 4 / 3
    else if (ratio === '3:4') targetRatio = 3 / 4
    else if (ratio === '16:9') targetRatio = 16 / 9

    setCrop((prev) => {
      let w = prev.w
      let h = Math.round(w / targetRatio)
      if (h > imgH) {
        h = imgH
        w = Math.round(h * targetRatio)
      }
      if (w > imgW) {
        w = imgW
        h = Math.round(w / targetRatio)
      }
      const x = Math.max(0, Math.min(imgW - w, prev.x))
      const y = Math.max(0, Math.min(imgH - h, prev.y))
      return { x, y, w, h }
    })
  }

  // 指標事件轉原圖座標
  const toImageCoords = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const container = containerRef.current
    if (!container || imgDisplay.w === 0) return null
    const rect = container.getBoundingClientRect()
    const cx = clientX - rect.left
    const cy = clientY - rect.top

    const localX = cx - imgDisplay.x
    const localY = cy - imgDisplay.y

    const scale = imgDisplay.w / imgW
    const x = Math.max(0, Math.min(imgW, localX / scale))
    const y = Math.max(0, Math.min(imgH, localY / scale))
    return { x, y }
  }

  const handlePointerDown = (e: React.PointerEvent, type: DragType) => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)

    const pt = toImageCoords(e.clientX, e.clientY)
    if (!pt) return

    if (type === 'create') {
      const initialCrop = { x: pt.x, y: pt.y, w: 1, h: 1 }
      setCrop(initialCrop)
      dragRef.current = {
        type: 'se',
        startX: pt.x,
        startY: pt.y,
        startCrop: initialCrop,
      }
      return
    }

    dragRef.current = {
      type,
      startX: pt.x,
      startY: pt.y,
      startCrop: { ...crop },
    }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const pt = toImageCoords(e.clientX, e.clientY)
    if (!pt) return

    const { type, startX, startY, startCrop } = dragRef.current
    const dx = pt.x - startX
    const dy = pt.y - startY

    const MIN_SIZE = 20

    if (type === 'move') {
      const x = Math.max(0, Math.min(imgW - startCrop.w, startCrop.x + dx))
      const y = Math.max(0, Math.min(imgH - startCrop.h, startCrop.y + dy))
      setCrop({ ...startCrop, x: Math.round(x), y: Math.round(y) })
      return
    }

    let newX = startCrop.x
    let newY = startCrop.y
    let newW = startCrop.w
    let newH = startCrop.h

    if (type.includes('e')) newW = Math.max(MIN_SIZE, startCrop.w + dx)
    if (type.includes('s')) newH = Math.max(MIN_SIZE, startCrop.h + dy)
    if (type.includes('w')) {
      const rawW = startCrop.w - dx
      if (rawW >= MIN_SIZE) {
        newX = startCrop.x + dx
        newW = rawW
      }
    }
    if (type.includes('n')) {
      const rawH = startCrop.h - dy
      if (rawH >= MIN_SIZE) {
        newY = startCrop.y + dy
        newH = rawH
      }
    }

    if (aspectRatio !== 'free') {
      let r = 1
      if (aspectRatio === '1:1') r = 1
      else if (aspectRatio === '4:3') r = 4 / 3
      else if (aspectRatio === '3:4') r = 3 / 4
      else if (aspectRatio === '16:9') r = 16 / 9

      if (type === 'e' || type === 'w' || Math.abs(dx) > Math.abs(dy)) {
        newH = Math.round(newW / r)
      } else {
        newW = Math.round(newH * r)
      }
    }

    newX = Math.max(0, Math.min(imgW - MIN_SIZE, newX))
    newY = Math.max(0, Math.min(imgH - MIN_SIZE, newY))
    newW = Math.min(imgW - newX, Math.max(MIN_SIZE, newW))
    newH = Math.min(imgH - newY, Math.max(MIN_SIZE, newH))

    setCrop({
      x: Math.round(newX),
      y: Math.round(newY),
      w: Math.round(newW),
      h: Math.round(newH),
    })
  }

  const handlePointerUp = () => {
    dragRef.current = null
  }

  const handleConfirmCrop = async () => {
    if (crop.w < 10 || crop.h < 10) return

    const canvas = document.createElement('canvas')
    canvas.width = crop.w
    canvas.height = crop.h
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h)

    let croppedMask: HTMLCanvasElement | undefined
    if (maskCanvas) {
      croppedMask = document.createElement('canvas')
      croppedMask.width = crop.w
      croppedMask.height = crop.h
      const mctx = croppedMask.getContext('2d')!
      mctx.drawImage(maskCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h)
    }

    const newImg = new Image()
    newImg.src = canvas.toDataURL('image/png')
    await new Promise<void>((resolve, reject) => {
      newImg.onload = () => resolve()
      newImg.onerror = () => reject(new Error('裁切圖片解析失敗'))
    })

    onApply(newImg, croppedMask)
  }

  const scale = imgDisplay.w / imgW
  const boxLeft = imgDisplay.x + crop.x * scale
  const boxTop = imgDisplay.y + crop.y * scale
  const boxW = crop.w * scale
  const boxH = crop.h * scale

  return (
    <div className="crop-modal-overlay" role="dialog" aria-modal="true">
      <div className="crop-modal-content">
        <div className="crop-modal-header">
          <div className="crop-title-group">
            <span className="crop-modal-title">✂️ 裁切圖片</span>
            <span className="crop-dimensions">
              {crop.w} × {crop.h} px
            </span>
          </div>

          <div className="crop-aspect-buttons">
            <button
              type="button"
              className={`crop-ratio-btn${aspectRatio === 'free' ? ' active' : ''}`}
              onClick={() => applyAspectRatio('free')}
            >
              自由
            </button>
            <button
              type="button"
              className={`crop-ratio-btn${aspectRatio === '1:1' ? ' active' : ''}`}
              onClick={() => applyAspectRatio('1:1')}
            >
              1:1
            </button>
            <button
              type="button"
              className={`crop-ratio-btn${aspectRatio === '4:3' ? ' active' : ''}`}
              onClick={() => applyAspectRatio('4:3')}
            >
              4:3
            </button>
            <button
              type="button"
              className={`crop-ratio-btn${aspectRatio === '3:4' ? ' active' : ''}`}
              onClick={() => applyAspectRatio('3:4')}
            >
              3:4 (證件)
            </button>
            <button
              type="button"
              className={`crop-ratio-btn${aspectRatio === '16:9' ? ' active' : ''}`}
              onClick={() => applyAspectRatio('16:9')}
            >
              16:9
            </button>
          </div>
        </div>

        <div
          ref={containerRef}
          className="crop-stage"
          onPointerDown={(e) => handlePointerDown(e, 'create')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {imgDisplay.w > 0 && (
            <>
              {/* 底層圖片畫布（直接以 drawImage 繪製，不受 blob URL 釋放影響） */}
              <canvas
                ref={sourceCanvasRef}
                className="crop-source-canvas"
                style={{
                  left: imgDisplay.x,
                  top: imgDisplay.y,
                  width: imgDisplay.w,
                  height: imgDisplay.h,
                }}
              />

              {/* 暗色遮罩層 (周圍四塊) */}
              <div
                className="crop-scrim"
                style={{
                  left: imgDisplay.x,
                  top: imgDisplay.y,
                  width: imgDisplay.w,
                  height: Math.max(0, boxTop - imgDisplay.y),
                }}
              />
              <div
                className="crop-scrim"
                style={{
                  left: imgDisplay.x,
                  top: boxTop,
                  width: Math.max(0, boxLeft - imgDisplay.x),
                  height: boxH,
                }}
              />
              <div
                className="crop-scrim"
                style={{
                  left: boxLeft + boxW,
                  top: boxTop,
                  width: Math.max(0, imgDisplay.x + imgDisplay.w - (boxLeft + boxW)),
                  height: boxH,
                }}
              />
              <div
                className="crop-scrim"
                style={{
                  left: imgDisplay.x,
                  top: boxTop + boxH,
                  width: imgDisplay.w,
                  height: Math.max(0, imgDisplay.y + imgDisplay.h - (boxTop + boxH)),
                }}
              />

              {/* 裁切框本體 */}
              <div
                className="crop-box"
                style={{
                  left: boxLeft,
                  top: boxTop,
                  width: boxW,
                  height: boxH,
                }}
                onPointerDown={(e) => handlePointerDown(e, 'move')}
              >
                {/* 三分法網格線 */}
                <div className="crop-grid-line crop-grid-h1" />
                <div className="crop-grid-line crop-grid-h2" />
                <div className="crop-grid-line crop-grid-v1" />
                <div className="crop-grid-line crop-grid-v2" />

                {/* 8 個縮放手柄 */}
                <div
                  className="crop-handle nw"
                  onPointerDown={(e) => handlePointerDown(e, 'nw')}
                />
                <div
                  className="crop-handle n"
                  onPointerDown={(e) => handlePointerDown(e, 'n')}
                />
                <div
                  className="crop-handle ne"
                  onPointerDown={(e) => handlePointerDown(e, 'ne')}
                />
                <div
                  className="crop-handle e"
                  onPointerDown={(e) => handlePointerDown(e, 'e')}
                />
                <div
                  className="crop-handle se"
                  onPointerDown={(e) => handlePointerDown(e, 'se')}
                />
                <div
                  className="crop-handle s"
                  onPointerDown={(e) => handlePointerDown(e, 's')}
                />
                <div
                  className="crop-handle sw"
                  onPointerDown={(e) => handlePointerDown(e, 'sw')}
                />
                <div
                  className="crop-handle w"
                  onPointerDown={(e) => handlePointerDown(e, 'w')}
                />
              </div>
            </>
          )}
        </div>

        <div className="crop-modal-footer">
          <button type="button" className="secondary" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="primary" onClick={handleConfirmCrop}>
            ✂️ 套用裁切
          </button>
        </div>
      </div>
    </div>
  )
}
