import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 相對路徑 base：部署到 GitHub Pages 專案子路徑（/<repo>/）也能正確載入資源
  base: './',
  preview: {
    // 允許 Cloudflare 快速隧道（*.trycloudflare.com）存取 vite preview
    allowedHosts: ['.trycloudflare.com'],
  },
})
