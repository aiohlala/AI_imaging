import { useState } from 'react'
import WatermarkApp from './components/WatermarkApp'
import BackgroundRemovalApp from './components/BackgroundRemoval/BackgroundRemovalApp'
import SkinToneApp from './components/SkinTone/SkinToneApp'
import ImageMergeApp from './components/ImageMerge/ImageMergeApp'

type Tab = 'watermark' | 'bg-removal' | 'skintone' | 'merge'

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('watermark')

  return (
    <div className="app">
      <header className="app-header">
        {/* 頂部三區塊功能切換導覽列 */}
        <nav className="feature-nav" role="tablist" aria-label="功能選擇">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'watermark'}
            className={`nav-tab-btn${activeTab === 'watermark' ? ' active' : ''}`}
            onClick={() => setActiveTab('watermark')}
          >
            <span className="tab-icon">🧽</span>
            <span>浮水印去除</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'bg-removal'}
            className={`nav-tab-btn${activeTab === 'bg-removal' ? ' active' : ''}`}
            onClick={() => setActiveTab('bg-removal')}
          >
            <span className="tab-icon">✂️</span>
            <span>背景去除</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'skintone'}
            className={`nav-tab-btn${activeTab === 'skintone' ? ' active' : ''}`}
            onClick={() => setActiveTab('skintone')}
          >
            <span className="tab-icon">🎨</span>
            <span>人像膚色調和</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'merge'}
            className={`nav-tab-btn${activeTab === 'merge' ? ' active' : ''}`}
            onClick={() => setActiveTab('merge')}
          >
            <span className="tab-icon">🧩</span>
            <span>影像合併</span>
          </button>
        </nav>

        <h1>
          {activeTab === 'watermark' && '浮水印去除工具'}
          {activeTab === 'bg-removal' && 'AI 智慧背景去除'}
          {activeTab === 'skintone' && 'AI 人像膚色勻稱工具'}
          {activeTab === 'merge' && 'AI 影像無縫合併工具'}
        </h1>
        <p className="subtitle">
          {activeTab === 'watermark' && '純前端處理，支援自由塗抹筆刷與快速框選浮水印'}
          {activeTab === 'bg-removal' && 'Google MediaPipe WebAssembly 本機去背，支援透明 PNG 與證件底色替換'}
          {activeTab === 'skintone' && 'AI 自動分離臉部與身體 ＋ OKLab 感官色彩轉移，自然勻稱'}
          {activeTab === 'merge' && '支援無縫拼接（左右/上下自選比例、獨立對位）與 AI 頭身智慧接合'}
        </p>
      </header>

      <main className="app-main">
        {/* 保持三者 DOM 狀態獨立且互不干擾 */}
        <div
          role="tabpanel"
          style={{ display: activeTab === 'watermark' ? 'block' : 'none' }}
        >
          <WatermarkApp />
        </div>

        <div
          role="tabpanel"
          style={{ display: activeTab === 'bg-removal' ? 'block' : 'none' }}
        >
          <BackgroundRemovalApp />
        </div>

        <div
          role="tabpanel"
          style={{ display: activeTab === 'skintone' ? 'block' : 'none' }}
        >
          <SkinToneApp />
        </div>

        <div
          role="tabpanel"
          style={{ display: activeTab === 'merge' ? 'block' : 'none' }}
        >
          <ImageMergeApp />
        </div>
      </main>

      <footer className="app-footer">
        <p>
          {activeTab === 'watermark' && '使用 OpenCV Telea inpainting 演算法，所有運算皆在瀏覽器本機完成。'}
          {activeTab === 'bg-removal' && '使用 Google MediaPipe 神經網絡模型，100% 本機端 WebAssembly/WebGPU 加速。'}
          {activeTab === 'skintone' && '使用 MediaPipe 人像語意分割與 OKLab 感官色彩空間，保護個人隱私。'}
          {activeTab === 'merge' && '100% 瀏覽器本機端運算，支援無縫拼接與高精度人像頭身融合。'}
        </p>
      </footer>
    </div>
  )
}
