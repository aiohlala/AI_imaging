# AGENTS.md — 給 AI 助手的開發指引

## 專案是什麼

純前端的「去除圖片浮水印 / 文字」網站。使用者上傳圖片、用筆刷塗出要去除的區域，以 OpenCV.js 的 Telea inpainting 演算法在瀏覽器本機填補，全程不經過伺服器。

- 技術棧：Vite 8（rolldown）+ React 19 + TypeScript，純 CSS（無 UI framework），無後端
- UI 語言：繁體中文
- 主要依賴：`@techstark/opencv-js`（OpenCV 的 WASM 版本）

## 常用指令

```bash
npm install
npm run dev       # 開發伺服器
npm run build     # tsc 型別檢查 + 產出 dist/
npm run lint      # oxlint，提交前必跑，須 0 errors
npm run preview   # 本機預覽 build 結果（port 4173）
```

## 檔案結構

```
src/
├── App.tsx                    # 狀態機：empty → editing → processing → done
├── components/
│   ├── UploadZone.tsx         # 拖曳 / 選檔 / 貼上上傳
│   ├── MaskEditor.tsx         # 筆刷塗 mask（pointer events、undo、橡皮擦）
│   └── ResultView.tsx         # 前後對比滑桿、下載 PNG
├── lib/
│   └── inpaint.ts             # OpenCV 載入 + cv.inpaint 封裝
├── index.css                  # 全部樣式（深色主題）
└── main.tsx
```

## 關鍵陷阱（踩過的坑，勿踩第二次）

**絕對不要 `import('@techstark/opencv-js')` 或 `import ... from '@techstark/opencv-js'`。**

rolldown-vite 的 ESM interop（`__toESM`）會把 emscripten 的 Promise 模組包成「以 `Promise.prototype` 為原型但無內部結構的假 Promise」，被 promise chain 解包時拋出：

```
TypeError: Method Promise.prototype.then called on incompatible receiver #<Promise>
```

這個錯只在**瀏覽器跑打包後的程式**才會發生；Node 裡直接 import 套件完全正常，所以單靠 Node 測試抓不到。

正確做法（已實作於 `src/lib/inpaint.ts`，不要改回 import）：

1. `import opencvJsUrl from '@techstark/opencv-js/dist/opencv.js?url'` 取得檔案 URL
2. 動態插入 `<script src={opencvJsUrl}>`（UMD 版會把真正的 Promise 掛到 `globalThis.cv`）
3. `await globalThis.cv` 取得初始化完成的 cv 物件

其他注意事項：

- `cv.inpaint` 只接受 8UC1/8UC3，RGBA 圖要先 `cvtColor` 去 alpha
- 所有 `cv.Mat` 用完必須 `delete()`，否則 WASM 記憶體洩漏
- 圖片最長邊 > 2500px 時會等比縮小再處理（`MAX_SIDE`），避免 WASM 記憶體不足
- mask 以原圖解析度記錄，顯示時才縮放；改動 MaskEditor 時注意座標換算

## 部署（GitHub Pages）

1. 把本專案目錄的內容推到 GitHub repo 的 `main` 分支（`.github/workflows/deploy.yml` 已內建）
2. Repo → Settings → Pages → Source 選 **GitHub Actions**
3. 每次 push 到 main 就會自動 build + 部署，網址為 `https://<user>.github.io/<repo>/`

`vite.config.ts` 已設 `base: './'`（相對路徑），所以不管 repo 叫什麼名字都能正確載入資源，不需要改設定。

## 驗證方式

- `npm run build && npm run lint` 必須通過
- 功能驗證需要真實瀏覽器（OpenCV 是 WASM）。可用 Playwright（`playwright-core` + 系統 Chrome）寫端到端腳本：上傳測試圖 → `page.mouse` 在 `.overlay-canvas` 上畫一筆 → 點「開始去除浮水印」→ 斷言出現「下載」按鈕且無 console error

## 開發風格

- 最小改动原則：不做沒被要求的功能（YAGNI）
- 新程式碼風格比照周圍既有程式碼
- 有意義的註解用繁體中文（比照現有檔案）
