import { useState } from 'react'
import HeadSwapUpload from './HeadSwapUpload'
import HeadSwapViewer from './HeadSwapViewer'

export default function HeadSwapApp() {
  const [headImage, setHeadImage] = useState<HTMLImageElement | null>(null)
  const [headName, setHeadName] = useState<string>('')
  const [targetImage, setTargetImage] = useState<HTMLImageElement | null>(null)
  const [targetName, setTargetName] = useState<string>('')

  const handleImagesReady = (
    hImg: HTMLImageElement,
    hName: string,
    tImg: HTMLImageElement,
    tName: string,
  ) => {
    setHeadImage(hImg)
    setHeadName(hName)
    setTargetImage(tImg)
    setTargetName(tName)
  }

  const handleReset = () => {
    setHeadImage(null)
    setHeadName('')
    setTargetImage(null)
    setTargetName('')
  }

  return (
    <div className="headswap-app-container">
      {!headImage || !targetImage ? (
        <HeadSwapUpload onImagesReady={handleImagesReady} />
      ) : (
        <HeadSwapViewer
          headImage={headImage}
          headName={headName}
          targetImage={targetImage}
          targetName={targetName}
          onReset={handleReset}
        />
      )}
    </div>
  )
}
