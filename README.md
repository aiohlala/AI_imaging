# 浮水印去除工具

純前端的圖片浮水印 / 文字去除工具。用筆刷塗抹要去除的區域，透過 OpenCV inpainting 演算法在瀏覽器本機完成修復，圖片不會離開你的裝置。

## 功能

- **上傳圖片**：拖曳上傳、點擊選檔，或直接 Ctrl / Cmd + V 貼上圖片（支援 PNG / JPG / WebP）
- **Mask 塗抹**：半透明紅色疊層即時預覽塗抹範圍，可調整筆刷大小、切換橡皮擦、復原（最多 30 步）與清除全部；同時支援滑鼠與觸控
- **智慧去除**：以 OpenCV Telea inpainting 演算法填補塗抹區域
- **前後對比**：拖曳分隔線比較原圖與處理結果，可下載 PNG 或返回繼續編輯
- **RWD**：手機、平板、桌面皆可使用

## 本機開發

```bash
npm install
npm run dev
```

其他指令：

```bash
npm run lint      # oxlint 靜態檢查
npm run preview   # 預覽建置結果
```

## 建置與部署

```bash
npm run build
```

產出 `dist/` 目錄，為純靜態檔案，可部署至任意靜態託管服務（Cloudflare Pages、GitHub Pages、Netlify、Vercel 等）。

### GitHub Pages（已內建自動部署）

1. 把本專案推到 GitHub repo 的 `main` 分支。
2. Repo → **Settings → Pages → Source** 選 **GitHub Actions**。
3. 之後每次 push 到 `main`，`.github/workflows/deploy.yml` 會自動 build 並部署到 `https://<user>.github.io/<repo>/`。

`vite.config.ts` 已設定 `base: './'`（相對路徑），任何 repo 名稱都能正確運作，無需調整。

## 隱私說明

本工具為純前端應用：圖片只會在你的瀏覽器中以 Canvas / WebAssembly 處理，**不會上傳到任何伺服器**，也沒有任何追蹤或分析。關閉分頁後資料即消失。

## 原理簡述

1. 使用者以筆刷在原圖解析度的 mask 畫布上標記要去除的區域。
2. 若原圖最長邊超過 2500px，先等比縮小（mask 同步縮放），避免 WASM 記憶體不足。
3. 使用 OpenCV.js 的 `cv.inpaint`（Telea 演算法）：以 mask 區域周圍的像素資訊，沿邊界向內逐步擴散填補，達到自然的修復效果。
4. 所有 `cv.Mat` 使用後皆呼叫 `delete()` 釋放 WASM 記憶體。

## 技術棧

- Vite 8 + React 19 + TypeScript
- [@techstark/opencv-js](https://github.com/TechStark/opencv-js)（OpenCV 的 WebAssembly 版本，動態載入）
- 純 CSS，無 UI 框架
